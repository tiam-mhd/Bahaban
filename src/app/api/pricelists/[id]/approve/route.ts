import { ApiError, fail, json, readJson, requireSameOrigin, requireBranch } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { transaction } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const scope = await requireBranch(request);
    const { id } = await context.params;
    const body = await readJson<{ rowIds?: unknown; confirm?: unknown }>(request);
    if (
      body.confirm !== true ||
      !Array.isArray(body.rowIds) ||
      body.rowIds.length < 1 ||
      body.rowIds.length > 500 ||
      body.rowIds.some((row) => typeof row !== "string")
    ) {
      throw new ApiError(400, "تأیید و ردیف‌های انتخاب‌شده معتبر نیستند.", "invalid_approval");
    }
    const rowIds = [...new Set(body.rowIds as string[])];
    if (rowIds.length !== body.rowIds.length)
      throw new ApiError(400, "یک ردیف بیش از یک بار انتخاب شده است.", "duplicate_rows");
    const approval = await transaction(async (client) => {
      const list = await client.query<{ status: string }>(
        "SELECT status FROM price_lists WHERE id = $1 AND branch_id = $2 AND business_id = $3 FOR UPDATE",
        [id, scope.branchId, scope.businessId],
      );
      if (!list.rowCount)
        throw new ApiError(404, "قیمت‌نامه در این شعبه پیدا نشد.", "price_list_not_found");
      if (list.rows[0].status !== "in_review")
        throw new ApiError(409, "این قیمت‌نامه قابل تأیید نیست.", "price_list_closed");
      const rows = await client.query<{
        id: string;
        product_id: string | null;
        price_rial: string | null;
        previous_price_rial: string | null;
        expected_product_version: number | null;
        reviewed: boolean;
        skipped: boolean;
        source_row: number;
        product_name: string;
      }>(
        `SELECT r.id, r.matched_product_id AS product_id, r.price_rial::text AS price_rial,
          r.previous_price_rial::text AS previous_price_rial, r.expected_product_version, r.reviewed, r.skipped, r.source_row, p.name AS product_name
         FROM price_list_rows r LEFT JOIN products p ON p.id = r.matched_product_id AND p.branch_id = r.branch_id
         WHERE r.price_list_id = $1 AND r.branch_id = $2 AND r.business_id = $3 AND r.id = ANY($4::uuid[])
         ORDER BY r.source_row FOR UPDATE OF r`,
        [id, scope.branchId, scope.businessId, rowIds],
      );
      if (rows.rowCount !== rowIds.length)
        throw new ApiError(404, "یک یا چند ردیف در این شعبه پیدا نشد.", "row_not_found");
      for (const row of rows.rows) {
        if (
          !row.reviewed ||
          row.skipped ||
          !row.product_id ||
          row.price_rial === null ||
          row.expected_product_version === null
        ) {
          throw new ApiError(
            409,
            `ردیف ${row.source_row} هنوز قابل تأیید نیست. آن را بازبینی یا کنار بگذارید.`,
            "row_not_reviewed",
          );
        }
      }
      const duplicateProducts = await client.query(
        `SELECT matched_product_id FROM price_list_rows
         WHERE price_list_id = $1 AND branch_id = $2 AND business_id = $3 AND NOT skipped AND approved_at IS NULL
           AND matched_product_id = ANY($4::uuid[])
         GROUP BY matched_product_id HAVING count(*) > 1 LIMIT 1`,
        [id, scope.branchId, scope.businessId, rows.rows.map((row) => row.product_id)],
      );
      if (duplicateProducts.rowCount)
        throw new ApiError(
          409,
          "برای یک کالا چند ردیف قیمت‌نامه وجود دارد. ردیف معتبر را نگه دارید و ردیف‌های دیگر را کنار بگذارید.",
          "duplicate_product_in_review",
        );
      for (const row of rows.rows) {
        const update = await client.query(
          `UPDATE products SET cost_price_rial = $1, version = version + 1, updated_at = now()
           WHERE id = $2 AND branch_id = $3 AND business_id = $4 AND version = $5
             AND cost_price_rial IS NOT DISTINCT FROM $6::bigint`,
          [
            row.price_rial,
            row.product_id,
            scope.branchId,
            scope.businessId,
            row.expected_product_version,
            row.previous_price_rial,
          ],
        );
        if (update.rowCount !== 1)
          throw new ApiError(
            409,
            `قیمت کالای ردیف ${row.source_row} از زمان بازبینی تغییر کرده است. آن را دوباره بررسی کنید.`,
            "stale_product_price",
          );
        await client.query(
          "UPDATE price_list_rows SET approved_at = now() WHERE id = $1 AND branch_id = $2",
          [row.id, scope.branchId],
        );
        await client.query(
          `INSERT INTO price_history(branch_id,business_id,product_id,price_list_id,row_id,actor_id,previous_price_rial,new_price_rial)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            scope.branchId,
            scope.businessId,
            row.product_id,
            id,
            row.id,
            scope.id,
            row.previous_price_rial,
            row.price_rial,
          ],
        );
        await recordAudit(client, {
          businessId: scope.businessId,
          branchId: scope.branchId,
          actorId: scope.id,
          eventType: "product.purchase_price_approved",
          entityType: "product",
          entityId: row.product_id,
          details: {
            priceListId: id,
            priceListRowId: row.id,
            productName: row.product_name,
            previousPriceRial: row.previous_price_rial,
            newPriceRial: row.price_rial,
          },
        });
      }
      const pending = await client.query<{ count: string }>(
        "SELECT count(*) FROM price_list_rows WHERE price_list_id = $1 AND branch_id = $2 AND NOT skipped AND approved_at IS NULL",
        [id, scope.branchId],
      );
      const completed = Number(pending.rows[0].count) === 0;
      if (completed)
        await client.query(
          "UPDATE price_lists SET status = 'approved', approved_at = now(), approved_by = $1 WHERE id = $2 AND branch_id = $3",
          [scope.id, id, scope.branchId],
        );
      await recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: "price_list.approval_batch",
        entityType: "price_list",
        entityId: id,
        details: { rowCount: rows.rowCount, completed },
      });
      return { approvedRows: rows.rowCount, completed, pendingRows: Number(pending.rows[0].count) };
    });
    return json(approval);
  } catch (error) {
    return fail(error);
  }
}
