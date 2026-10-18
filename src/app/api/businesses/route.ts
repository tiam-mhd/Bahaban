import { ApiError, fail, json, readJson, requireSameOrigin, requireUser } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { transaction } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(request);
    const body = await readJson<{ name?: unknown }>(request);
    if (typeof body.name !== "string")
      throw new ApiError(400, "نام کسب‌وکار را وارد کنید.", "invalid_business");
    const name = body.name.trim();
    if (name.length < 2 || name.length > 120)
      throw new ApiError(400, "نام کسب‌وکار باید بین ۲ تا ۱۲۰ نویسه باشد.", "invalid_business");
    const created = await transaction(async (client) => {
      const business = await client.query<{ id: string }>(
        "INSERT INTO businesses(name) VALUES ($1) RETURNING id",
        [name],
      );
      const businessId = business.rows[0].id;
      await client.query(
        "INSERT INTO business_memberships(business_id, user_id, role) VALUES ($1, $2, 'owner')",
        [businessId, user.id],
      );
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branches(business_id, name, is_primary) VALUES ($1, 'شعبهٔ اصلی', true) RETURNING id`,
        [businessId],
      );
      const branchId = branch.rows[0].id;
      await client.query("INSERT INTO branch_settings(branch_id, business_id) VALUES ($1, $2)", [
        branchId,
        businessId,
      ]);
      await client.query(
        "UPDATE sessions SET active_branch_id = $1 WHERE id = $2 AND user_id = $3",
        [branchId, user.sessionId, user.id],
      );
      await recordAudit(client, {
        businessId,
        branchId,
        actorId: user.id,
        eventType: "business.created",
        entityType: "business",
        entityId: businessId,
        details: { name, branchName: "شعبهٔ اصلی" },
      });
      return { businessId, branchId };
    });
    return json(created, 201);
  } catch (error) {
    return fail(error);
  }
}
