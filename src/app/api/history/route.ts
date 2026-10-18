import { fail, json, requireBranch } from "@/lib/api";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = await requireBranch(request);
    const url = new URL(request.url);
    const page = Math.min(10_000, Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1));
    const size = Math.min(100, Math.max(1, Number(url.searchParams.get("size") ?? 50) || 50));
    const result = await query(
      `SELECT e.id, e.event_type, e.entity_type, e.entity_id,
        jsonb_strip_nulls(e.details || jsonb_build_object('productName', p.name, 'title', l.title)) AS details, e.created_at
       FROM audit_events e
       LEFT JOIN products p ON e.entity_type = 'product' AND p.id = e.entity_id AND p.branch_id = e.branch_id
       LEFT JOIN price_lists l ON e.entity_type = 'price_list' AND l.id = e.entity_id AND l.branch_id = e.branch_id
       WHERE e.branch_id = $1 AND e.business_id = $2
       ORDER BY e.created_at DESC LIMIT $3 OFFSET $4`,
      [scope.branchId, scope.businessId, size, (page - 1) * size],
    );
    return json({ rows: result.rows, page, size });
  } catch (error) {
    return fail(error);
  }
}
