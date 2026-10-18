import { ApiError, fail, json, requireBranch } from "@/lib/api";
import { query } from "@/lib/db";
import { clampPage, parsePagination } from "@/lib/pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireBranch(request);
    const { id } = await context.params;
    const url = new URL(request.url);
    const pagination = parsePagination(url.searchParams, { defaultSize: 25 });
    const list = await query(
      `SELECT l.id, l.title, l.source_file_name, l.source_date, l.currency, l.status, l.row_count,
        l.created_at, l.approved_at, s.name AS supplier_name
       FROM price_lists l JOIN suppliers s ON s.id = l.supplier_id AND s.branch_id = l.branch_id
       WHERE l.id = $1 AND l.branch_id = $2 AND l.business_id = $3`,
      [id, scope.branchId, scope.businessId],
    );
    if (!list.rowCount)
      throw new ApiError(404, "قیمت‌نامه در این شعبه پیدا نشد.", "price_list_not_found");
    const [count, summary] = await Promise.all([
      query<{ count: string }>(
      "SELECT count(*) FROM price_list_rows WHERE price_list_id = $1 AND branch_id = $2 AND business_id = $3",
      [id, scope.branchId, scope.businessId],
      ),
      query<{ pending_count: number; ready_count: number; skipped_count: number }>(
        `SELECT count(*) FILTER (WHERE NOT reviewed AND NOT skipped)::int AS pending_count,
           count(*) FILTER (WHERE reviewed AND NOT skipped AND approved_at IS NULL)::int AS ready_count,
           count(*) FILTER (WHERE skipped)::int AS skipped_count
         FROM price_list_rows WHERE price_list_id = $1 AND branch_id = $2 AND business_id = $3`,
        [id, scope.branchId, scope.businessId],
      ),
    ]);
    const total = Number(count.rows[0].count);
    const page = clampPage(pagination.page, pagination.size, total);
    const rows = await query(
      `SELECT r.id, r.source_row, r.source_name, r.source_sku, r.source_barcode, r.source_brand, r.source_model,
        r.source_unit, r.price_rial::text AS price_rial, r.previous_price_rial::text AS previous_price_rial,
        r.expected_product_version, r.matched_product_id, r.match_method, r.confidence, r.warning_codes,
        r.reviewed, r.skipped, r.approved_at,
        p.name AS matched_product_name, p.sku AS matched_product_sku, p.unit AS matched_product_unit,
        p.cost_price_rial::text AS current_cost_rial, p.sale_price_rial::text AS current_sale_rial,
        COALESCE((SELECT json_agg(json_build_object('productId', ms.product_id, 'name', mp.name, 'sku', mp.sku,
          'unit', mp.unit, 'costPrice', mp.cost_price_rial::text, 'confidence', ms.confidence, 'method', ms.method)
          ORDER BY ms.confidence DESC) FROM match_suggestions ms
          JOIN products mp ON mp.id = ms.product_id AND mp.branch_id = r.branch_id
          WHERE ms.row_id = r.id AND ms.branch_id = r.branch_id), '[]'::json) AS suggestions
       FROM price_list_rows r LEFT JOIN products p ON p.id = r.matched_product_id AND p.branch_id = r.branch_id
       WHERE r.price_list_id = $1 AND r.branch_id = $2 AND r.business_id = $3
       ORDER BY r.source_row LIMIT $4 OFFSET $5`,
      [id, scope.branchId, scope.businessId, pagination.size, (page - 1) * pagination.size],
    );
    return json({
      list: list.rows[0],
      rows: rows.rows,
      total,
      page,
      size: pagination.size,
      summary: summary.rows[0],
    });
  } catch (error) {
    return fail(error);
  }
}
