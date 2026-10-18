import { fail, json, requireBranch } from "@/lib/api";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = await requireBranch(request);
    const result = await query(
      `SELECT l.id, l.title, l.source_file_name, l.source_date, l.currency, l.status, l.row_count,
        l.created_at, l.approved_at, s.name AS supplier_name,
        count(r.id) FILTER (WHERE r.approved_at IS NOT NULL)::int AS approved_rows,
        count(r.id) FILTER (WHERE r.skipped)::int AS skipped_rows,
        count(r.id) FILTER (WHERE NOT r.reviewed AND NOT r.skipped)::int AS pending_rows
       FROM price_lists l JOIN suppliers s ON s.id = l.supplier_id AND s.branch_id = l.branch_id
       LEFT JOIN price_list_rows r ON r.price_list_id = l.id AND r.branch_id = l.branch_id
       WHERE l.branch_id = $1 AND l.business_id = $2
       GROUP BY l.id, s.name ORDER BY l.created_at DESC LIMIT 100`,
      [scope.branchId, scope.businessId],
    );
    return json({ rows: result.rows });
  } catch (error) {
    return fail(error);
  }
}
