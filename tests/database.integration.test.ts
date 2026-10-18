import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";

const testUrl = process.env.TEST_DATABASE_URL;
const databaseName = testUrl ? new URL(testUrl).pathname.replace(/^\//, "") : "";
const enabled = Boolean(testUrl && /(^|[_-])(test|testing|ci)([_-]|$)/i.test(databaseName));

test(
  "PostgreSQL enforces primary-branch and cross-branch relationships",
  { skip: !enabled },
  async () => {
    if (!testUrl) return;
    const { Pool } = pg;
    const pool = new Pool({ connectionString: testUrl, max: 1 });
    const client = await pool.connect();
    const schema = `bahaban_test_${randomUUID().replace(/-/g, "")}`;
    const quotedSchema = `"${schema}"`;
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`);
      await client.query(`SET search_path TO ${quotedSchema}, public`);
      const sql = await readFile(
        fileURLToPath(new URL("../db/migrations/0001_initial.sql", import.meta.url)),
        "utf8",
      );
      await client.query(
        "CREATE TABLE schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      await client.query(sql);

      const userA = (
        await client.query<{ id: string }>(
          "INSERT INTO users(phone_e164) VALUES ('+989121234501') RETURNING id",
        )
      ).rows[0].id;
      const userB = (
        await client.query<{ id: string }>(
          "INSERT INTO users(phone_e164) VALUES ('+989121234502') RETURNING id",
        )
      ).rows[0].id;

      async function createBusiness(userId: string, name: string) {
        await client.query("BEGIN");
        const businessId = (
          await client.query<{ id: string }>(
            "INSERT INTO businesses(name) VALUES ($1) RETURNING id",
            [name],
          )
        ).rows[0].id;
        await client.query(
          "INSERT INTO business_memberships(business_id,user_id,role) VALUES ($1,$2,'owner')",
          [businessId, userId],
        );
        const branchId = (
          await client.query<{ id: string }>(
            "INSERT INTO branches(business_id,name,is_primary) VALUES ($1,'شعبهٔ اصلی',true) RETURNING id",
            [businessId],
          )
        ).rows[0].id;
        await client.query("INSERT INTO branch_settings(branch_id,business_id) VALUES ($1,$2)", [
          branchId,
          businessId,
        ]);
        await client.query("COMMIT");
        return { businessId, branchId };
      }

      const a = await createBusiness(userA, "کسب‌وکار الف");
      const b = await createBusiness(userB, "کسب‌وکار ب");
      const productA = (
        await client.query<{ id: string }>(
          "INSERT INTO products(branch_id,business_id,name,sku,cost_price_rial) VALUES ($1,$2,'کالای الف','A-1',10000) RETURNING id",
          [a.branchId, a.businessId],
        )
      ).rows[0].id;
      const productB = (
        await client.query<{ id: string }>(
          "INSERT INTO products(branch_id,business_id,name,sku,cost_price_rial) VALUES ($1,$2,'کالای ب','B-1',20000) RETURNING id",
          [b.branchId, b.businessId],
        )
      ).rows[0].id;
      const supplierA = (
        await client.query<{ id: string }>(
          "INSERT INTO suppliers(branch_id,business_id,name) VALUES ($1,$2,'تأمین‌کننده الف') RETURNING id",
          [a.branchId, a.businessId],
        )
      ).rows[0].id;
      const listA = (
        await client.query<{ id: string }>(
          `INSERT INTO price_lists(branch_id,business_id,supplier_id,title,source_file_name,source_hash,source_date,created_by)
       VALUES ($1,$2,$3,'فهرست الف','a.csv',$4,'2026-01-01',$5) RETURNING id`,
          [a.branchId, a.businessId, supplierA, "a".repeat(64), userA],
        )
      ).rows[0].id;

      const visible = await client.query(
        "SELECT p.id FROM products p JOIN business_memberships m ON m.business_id = p.business_id WHERE m.user_id = $1 AND p.branch_id = $2",
        [userA, b.branchId],
      );
      assert.equal(
        visible.rowCount,
        0,
        "a user-scoped branch query cannot return another business' products",
      );
      await client.query("SAVEPOINT cross_branch_row");
      await assert.rejects(
        client.query(
          `INSERT INTO price_list_rows(price_list_id,branch_id,business_id,source_row,source_name,price_rial,matched_product_id)
       VALUES ($1,$2,$3,2,'کالای ب',30000,$4)`,
          [listA, a.branchId, a.businessId, productB],
        ),
        (error: { code?: string }) => error.code === "23503",
      );
      await client.query("ROLLBACK TO SAVEPOINT cross_branch_row");
      await client.query("RELEASE SAVEPOINT cross_branch_row");

      const primary = await client.query(
        "SELECT id FROM branches WHERE business_id = $1 AND is_primary",
        [a.businessId],
      );
      assert.equal(primary.rowCount, 1);
      await assert.rejects(
        client.query("UPDATE branches SET is_primary = false WHERE id = $1", [primary.rows[0].id]),
      );
      await assert.rejects(
        client.query("DELETE FROM branches WHERE id = $1", [primary.rows[0].id]),
        (error: { message?: string }) =>
          (error.message ?? "").includes("Primary branch cannot be deleted"),
      );
      assert.equal(productA.length > 0, true);
    } finally {
      client.release();
      await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
      await pool.end();
    }
  },
);
