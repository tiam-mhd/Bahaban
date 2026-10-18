import { ApiError, fail, json, readJson, requireSameOrigin, requireBranch } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { isUuid } from "@/lib/category-utils";
import { transaction, query } from "@/lib/db";
import { normalizeText, parseMoneyToRial } from "@/lib/domain";
import { clampPage, parsePagination } from "@/lib/pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = await requireBranch(request);
    const url = new URL(request.url);
    const search = normalizeText(url.searchParams.get("q") ?? "").slice(0, 100);
    const pagination = parsePagination(url.searchParams, { defaultSize: 25 });
    let page = pagination.page;
    const { size } = pagination;
    const normalizedName = `replace(replace(replace(lower(name), 'ي', 'ی'), 'ك', 'ک'), '‌', ' ')`;
    const values: unknown[] = [scope.branchId];
    let condition = "branch_id = $1 AND archived_at IS NULL";
    if (search) {
      values.push(`%${search}%`);
      condition += ` AND (${normalizedName} ILIKE $2 OR lower(sku) ILIKE $2 OR barcode ILIKE $2 OR lower(brand) ILIKE $2 OR lower(model) ILIKE $2)`;
    }
    const count = await query<{ count: string }>(
      `SELECT count(*) FROM products WHERE ${condition}`,
      values,
    );
    const total = Number(count.rows[0].count);
    page = clampPage(page, size, total);
    values.push(size, (page - 1) * size);
    const rows = await query(
      `SELECT id, name, sku, barcode, brand, model, unit, cost_price_rial::text AS cost_price_rial,
        sale_price_rial::text AS sale_price_rial, is_active, version, created_at
       FROM products WHERE ${condition} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return json({ rows: rows.rows, total, page, size });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const scope = await requireBranch(request);
    const body = await readJson<Record<string, unknown>>(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 200)
      throw new ApiError(400, "نام کالا را وارد کنید.", "invalid_product");
    const currency = body.currency === "IRT" ? "IRT" : "IRR";
    const categoryId =
      body.categoryId === undefined || body.categoryId === null || body.categoryId === ""
        ? null
        : body.categoryId;
    if (categoryId !== null && !isUuid(categoryId))
      throw new ApiError(400, "دسته‌بندی انتخاب‌شده معتبر نیست.", "invalid_category");
    const optionalMoney = (value: unknown) =>
      value === "" || value === null || value === undefined
        ? null
        : parseMoneyToRial(value, currency).toString();
    const sku = typeof body.sku === "string" ? body.sku.trim().slice(0, 100) : "";
    const barcode = typeof body.barcode === "string" ? body.barcode.trim().slice(0, 100) : "";
    const product = await transaction(async (client) => {
      if (categoryId) {
        const category = await client.query(
          `SELECT id FROM product_categories
           WHERE id = $1 AND branch_id = $2 AND business_id = $3 FOR UPDATE`,
          [categoryId, scope.branchId, scope.businessId],
        );
        if (!category.rowCount)
          throw new ApiError(404, "دسته‌بندی در این شعبه پیدا نشد.", "category_not_found");
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO products(branch_id, business_id, category_id, name, sku, barcode, brand, model, unit, cost_price_rial, sale_price_rial)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          scope.branchId,
          scope.businessId,
          categoryId,
          name,
          sku,
          barcode,
          typeof body.brand === "string" ? body.brand.trim().slice(0, 100) : "",
          typeof body.model === "string" ? body.model.trim().slice(0, 100) : "",
          typeof body.unit === "string" ? body.unit.trim().slice(0, 50) : "",
          optionalMoney(body.costPrice),
          optionalMoney(body.salePrice),
        ],
      );
      await recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: "product.created",
        entityType: "product",
        entityId: inserted.rows[0].id,
        details: { name, sku, barcode, categoryId },
      });
      return { id: inserted.rows[0].id };
    }).catch((error: { code?: string }) => {
      if (error.code === "23505")
        throw new ApiError(
          409,
          "این کد کالا یا بارکد قبلاً در این شعبه ثبت شده است.",
          "duplicate_product",
        );
      throw error;
    });
    return json(product, 201);
  } catch (error) {
    return fail(error);
  }
}
