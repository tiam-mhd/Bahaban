import { ApiError, fail, json, readJson, requireSameOrigin, requireBranch } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { transaction, query } from "@/lib/db";
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
    const sort = url.searchParams.get("sort") ?? "name";
    const order = url.searchParams.get("order") === "desc" ? "DESC" : "ASC";
    const sortSql: Record<string, string> = {
      name: `lower(name) ${order}, created_at DESC`,
      created: `created_at ${order}, lower(name) ASC`,
    };
    if (!sortSql[sort]) throw new ApiError(400, "مرتب‌سازی تأمین‌کننده معتبر نیست.", "invalid_supplier_sort");
    const values: unknown[] = [scope.branchId];
    let where = "branch_id = $1 AND archived_at IS NULL";
    if (search) {
      values.push(`%${search}%`);
      where += ` AND (lower(name) ILIKE $2 OR lower(note) ILIKE $2)`;
    }
    const count = await query<{ count: string }>(`SELECT count(*) FROM suppliers WHERE ${where}`, values);
    const total = Number(count.rows[0].count);
    const page = clampPage(pagination.page, pagination.size, total);
    const rows = await query(
      `SELECT id, name, note, created_at FROM suppliers WHERE ${where}
       ORDER BY ${sortSql[sort]} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pagination.size, (page - 1) * pagination.size],
    );
    return json({ rows: rows.rows, total, page, size: pagination.size });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const scope = await requireBranch(request);
    const body = await readJson<{ name?: unknown; note?: unknown }>(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (name.length < 2 || name.length > 160 || note.length > 1000)
      throw new ApiError(400, "نام تأمین‌کننده یا یادداشت معتبر نیست.", "invalid_supplier");
    const created = await transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO suppliers(branch_id, business_id, name, note) VALUES ($1,$2,$3,$4) RETURNING id`,
        [scope.branchId, scope.businessId, name, note],
      );
      await recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: "supplier.created",
        entityType: "supplier",
        entityId: result.rows[0].id,
        details: { name },
      });
      return { id: result.rows[0].id };
    });
    return json(created, 201);
  } catch (error) {
    return fail(error);
  }
}
