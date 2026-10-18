import { ApiError, fail, json, requireBranch } from "@/lib/api";
import { query } from "@/lib/db";
import { normalizeText } from "@/lib/domain";
import { clampPage, parsePagination } from "@/lib/pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = await requireBranch(request);
    const url = new URL(request.url);
    const pagination = parsePagination(url.searchParams, { defaultSize: 25 });
    const search = normalizeText(url.searchParams.get("q") ?? "").slice(0, 100);
    const status = url.searchParams.get("status") ?? "all";
    if (!["all", "in_review", "approved", "cancelled", "error"].includes(status))
      throw new ApiError(400, "فیلتر وضعیت قیمت‌نامه معتبر نیست.", "invalid_price_list_status");
    const values: unknown[] = [scope.branchId, scope.businessId];
    const conditions = ["l.branch_id = $1", "l.business_id = $2"];
    if (status !== "all") {
      values.push(status);
      conditions.push(`l.status = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(lower(l.title) ILIKE $${values.length} OR lower(l.source_file_name) ILIKE $${values.length} OR lower(s.name) ILIKE $${values.length})`);
    }
    const where = conditions.join(" AND ");
    const [count, summary] = await Promise.all([
      query<{ count: string }>(
        `SELECT count(*) FROM price_lists l JOIN suppliers s ON s.id = l.supplier_id AND s.branch_id = l.branch_id WHERE ${where}`,
        values,
      ),
      query<{ total: string; in_review_count: string; pending_row_count: string }>(
        `SELECT count(DISTINCT l.id)::text AS total,
           count(DISTINCT l.id) FILTER (WHERE l.status = 'in_review')::text AS in_review_count,
           count(r.id) FILTER (WHERE l.status = 'in_review' AND NOT r.reviewed AND NOT r.skipped)::text AS pending_row_count
         FROM price_lists l LEFT JOIN price_list_rows r ON r.price_list_id = l.id AND r.branch_id = l.branch_id
         WHERE l.branch_id = $1 AND l.business_id = $2`,
        [scope.branchId, scope.businessId],
      ),
    ]);
    const total = Number(count.rows[0].count);
    const page = clampPage(pagination.page, pagination.size, total);
    const result = await query(
      `SELECT l.id, l.title, l.source_file_name, l.source_date, l.currency, l.status, l.row_count,
        l.created_at, l.approved_at, s.name AS supplier_name,
        count(r.id) FILTER (WHERE r.approved_at IS NOT NULL)::int AS approved_rows,
        count(r.id) FILTER (WHERE r.skipped)::int AS skipped_rows,
        count(r.id) FILTER (WHERE NOT r.reviewed AND NOT r.skipped)::int AS pending_rows
       FROM price_lists l JOIN suppliers s ON s.id = l.supplier_id AND s.branch_id = l.branch_id
       LEFT JOIN price_list_rows r ON r.price_list_id = l.id AND r.branch_id = l.branch_id
       WHERE ${where}
       GROUP BY l.id, s.name ORDER BY l.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pagination.size, (page - 1) * pagination.size],
    );
    return json({
      rows: result.rows,
      total,
      page,
      size: pagination.size,
      summary: {
        total: Number(summary.rows[0].total),
        inReviewCount: Number(summary.rows[0].in_review_count),
        pendingRowCount: Number(summary.rows[0].pending_row_count),
      },
    });
  } catch (error) {
    return fail(error);
  }
}
