import { ApiError, fail, json, readJson, requireSameOrigin, requireUser } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { transaction, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(request);
    const body = await readJson<{ businessId?: unknown; name?: unknown }>(request);
    if (typeof body.businessId !== "string" || typeof body.name !== "string")
      throw new ApiError(400, "نام کسب‌وکار و شعبه را بررسی کنید.", "invalid_branch");
    const businessId = body.businessId;
    const name = body.name.trim();
    if (name.length < 2 || name.length > 120)
      throw new ApiError(400, "نام شعبه باید بین ۲ تا ۱۲۰ نویسه باشد.", "invalid_branch");
    const membership = await query<{ role: string }>(
      "SELECT role FROM business_memberships WHERE business_id = $1 AND user_id = $2",
      [businessId, user.id],
    );
    if (!membership.rowCount)
      throw new ApiError(404, "به این کسب‌وکار دسترسی ندارید.", "business_not_found");
    if (membership.rows[0].role !== "owner")
      throw new ApiError(403, "فقط مالک کسب‌وکار می‌تواند شعبه بسازد.", "owner_required");
    const result = await transaction(async (client) => {
      const branch = await client.query<{ id: string }>(
        "INSERT INTO branches(business_id,name,is_primary) VALUES ($1,$2,false) RETURNING id",
        [businessId, name],
      );
      const id = branch.rows[0].id;
      await client.query("INSERT INTO branch_settings(branch_id,business_id) VALUES ($1,$2)", [
        id,
        businessId,
      ]);
      await recordAudit(client, {
        businessId,
        branchId: id,
        actorId: user.id,
        eventType: "branch.created",
        entityType: "branch",
        entityId: id,
        details: { name },
      });
      return { id };
    });
    return json(result, 201);
  } catch (error) {
    return fail(error);
  }
}
