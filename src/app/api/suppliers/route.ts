import { ApiError, fail, json, readJson, requireSameOrigin, requireBranch } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { transaction, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = await requireBranch(request);
    const result = await query(
      `SELECT id, name, note, created_at FROM suppliers WHERE branch_id = $1 AND archived_at IS NULL ORDER BY name LIMIT 500`,
      [scope.branchId],
    );
    return json({ rows: result.rows });
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
