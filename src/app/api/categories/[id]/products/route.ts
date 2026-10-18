import { ApiError, fail, json, readJson, requireBranch, requireSameOrigin } from "@/lib/api";
import { isUuid, lockCategoryBranch } from "@/lib/category-utils";
import { recordAudit } from "@/lib/audit";
import { normalizeText } from "@/lib/domain";
import { query, transaction } from "@/lib/db";
import { clampPage, parsePagination } from "@/lib/pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function productSearchExpression(alias: string): string {
  return `replace(replace(replace(lower(${alias}.name), 'ي', 'ی'), 'ك', 'ک'), '‌', ' ')`;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const scope = await requireBranch(request);
    const { id } = await context.params;
    if (!isUuid(id)) throw new ApiError(404, "دسته‌بندی پیدا نشد.", "category_not_found");
    const category = await query(
      "SELECT id FROM product_categories WHERE id = $1 AND branch_id = $2 AND business_id = $3",
      [id, scope.branchId, scope.businessId],
    );
    if (!category.rowCount) throw new ApiError(404, "دسته‌بندی پیدا نشد.", "category_not_found");

    const searchParams = new URL(request.url).searchParams;
    const available = searchParams.get("available") === "true";
    const search = normalizeText(searchParams.get("q") ?? "").slice(0, 100);
    const pagination = parsePagination(searchParams, { defaultSize: 25 });
    const status = searchParams.get("status") ?? "all";
    const sort = searchParams.get("sort") ?? (available ? "created" : "name");
    const order = searchParams.get("order") === "desc" ? "DESC" : "ASC";
    const sortSql: Record<string, string> = {
      name: `${productSearchExpression("p")} ${order}, p.name ${order}`,
      sku: `lower(p.sku) ${order}, ${productSearchExpression("p")} ASC`,
      created: `p.created_at ${order}, ${productSearchExpression("p")} ASC`,
      cost: `p.cost_price_rial ${order} NULLS LAST, ${productSearchExpression("p")} ASC`,
    };
    if (!sortSql[sort])
      throw new ApiError(400, "مرتب‌سازی کالا معتبر نیست.", "invalid_product_sort");
    if (status !== "all" && status !== "active" && status !== "inactive")
      throw new ApiError(400, "فیلتر وضعیت کالا معتبر نیست.", "invalid_product_status");

    const values: unknown[] = [scope.branchId, scope.businessId, id];
    const conditions = ["p.branch_id = $1", "p.business_id = $2", "p.archived_at IS NULL"];
    conditions.push(available ? "p.category_id IS DISTINCT FROM $3" : "p.category_id = $3");
    if (search) {
      values.push(`%${search}%`);
      const parameter = `$${values.length}`;
      conditions.push(
        `(${productSearchExpression("p")} ILIKE ${parameter} OR lower(p.sku) ILIKE ${parameter} OR p.barcode ILIKE ${parameter} OR lower(p.brand) ILIKE ${parameter} OR lower(p.model) ILIKE ${parameter})`,
      );
    }
    if (status === "active") conditions.push("p.is_active = true");
    if (status === "inactive") conditions.push("p.is_active = false");
    const where = conditions.join(" AND ");
    const count = await query<{ count: string }>(
      `SELECT count(*) FROM products p WHERE ${where}`,
      values,
    );
    const total = Number(count.rows[0].count);
    const page = clampPage(pagination.page, pagination.size, total);
    const pageValues = [...values, pagination.size, (page - 1) * pagination.size];
    const rows = await query(
      `SELECT p.id, p.name, p.sku, p.barcode, p.brand, p.model, p.unit,
         p.cost_price_rial::text AS cost_price_rial, p.sale_price_rial::text AS sale_price_rial,
         p.is_active, p.version, p.created_at, p.category_id, current_category.name AS category_name
       FROM products p
       LEFT JOIN product_categories current_category
         ON current_category.id = p.category_id AND current_category.branch_id = p.branch_id
       WHERE ${where}
       ORDER BY ${sortSql[sort]} LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
      pageValues,
    );
    return json({ rows: rows.rows, total, page, size: pagination.size });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request);
    const scope = await requireBranch(request);
    const { id } = await context.params;
    if (!isUuid(id)) throw new ApiError(404, "دسته‌بندی پیدا نشد.", "category_not_found");
    const body = await readJson<Record<string, unknown>>(request);
    const productId = body.productId;
    if (!isUuid(productId))
      throw new ApiError(400, "کالای انتخاب‌شده معتبر نیست.", "invalid_product");

    const result = await transaction(async (client) => {
      await lockCategoryBranch(client, scope.branchId, scope.businessId);
      const category = await client.query<{ name: string }>(
        `SELECT name FROM product_categories WHERE id = $1 AND branch_id = $2 AND business_id = $3 FOR UPDATE`,
        [id, scope.branchId, scope.businessId],
      );
      if (!category.rowCount) throw new ApiError(404, "دسته‌بندی پیدا نشد.", "category_not_found");
      const product = await client.query<{ name: string; category_id: string | null }>(
        `SELECT p.name, p.category_id FROM products p
         WHERE p.id = $1 AND p.branch_id = $2 AND p.business_id = $3 AND p.archived_at IS NULL FOR UPDATE`,
        [productId, scope.branchId, scope.businessId],
      );
      if (!product.rowCount)
        throw new ApiError(404, "کالا در این شعبه پیدا نشد.", "product_not_found");
      const previousCategoryId = product.rows[0].category_id;
      if (previousCategoryId === id)
        throw new ApiError(
          409,
          "این کالا از قبل در همین دسته قرار دارد.",
          "product_already_assigned",
        );
      await client.query(
        `UPDATE products SET category_id = $1, updated_at = now()
         WHERE id = $2 AND branch_id = $3 AND business_id = $4`,
        [id, productId, scope.branchId, scope.businessId],
      );
      await recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: previousCategoryId ? "product.category_changed" : "product.category_assigned",
        entityType: "product",
        entityId: productId,
        details: {
          productName: product.rows[0].name,
          previousCategoryId,
          categoryId: id,
          categoryName: category.rows[0].name,
        },
      });
      return { productId, categoryId: id, previousCategoryId };
    });
    return json(result);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request);
    const scope = await requireBranch(request);
    const { id } = await context.params;
    const productId = new URL(request.url).searchParams.get("productId");
    if (!isUuid(id)) throw new ApiError(404, "دسته‌بندی پیدا نشد.", "category_not_found");
    if (!isUuid(productId))
      throw new ApiError(400, "کالای انتخاب‌شده معتبر نیست.", "invalid_product");

    const result = await transaction(async (client) => {
      await lockCategoryBranch(client, scope.branchId, scope.businessId);
      const category = await client.query<{ name: string }>(
        "SELECT name FROM product_categories WHERE id = $1 AND branch_id = $2 AND business_id = $3 FOR UPDATE",
        [id, scope.branchId, scope.businessId],
      );
      if (!category.rowCount) throw new ApiError(404, "دسته‌بندی پیدا نشد.", "category_not_found");
      const product = await client.query(
        `UPDATE products SET category_id = NULL, updated_at = now()
         WHERE id = $1 AND category_id = $2 AND branch_id = $3 AND business_id = $4
         RETURNING name`,
        [productId, id, scope.branchId, scope.businessId],
      );
      if (!product.rowCount)
        throw new ApiError(404, "کالا در این دسته پیدا نشد.", "category_product_not_found");
      await recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: "product.category_removed",
        entityType: "product",
        entityId: productId,
        details: {
          productName: product.rows[0].name,
          categoryId: id,
          categoryName: category.rows[0].name,
        },
      });
      return { productId, categoryId: id };
    });
    return json(result);
  } catch (error) {
    return fail(error);
  }
}
