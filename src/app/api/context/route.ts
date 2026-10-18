import { ApiError, fail, json, readJson, requireSameOrigin, requireUser } from "@/lib/api";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(request);
    const body = await readJson<{ branchId?: unknown }>(request);
    if (typeof body.branchId !== "string")
      throw new ApiError(400, "شعبهٔ انتخاب‌شده معتبر نیست.", "invalid_branch");
    const branch = await query(
      `SELECT b.id FROM branches b JOIN business_memberships m ON m.business_id = b.business_id
       WHERE b.id = $1 AND b.is_active = true AND m.user_id = $2`,
      [body.branchId, user.id],
    );
    if (!branch.rowCount) throw new ApiError(404, "به این شعبه دسترسی ندارید.", "branch_not_found");
    await query("UPDATE sessions SET active_branch_id = $1 WHERE id = $2 AND user_id = $3", [
      body.branchId,
      user.sessionId,
      user.id,
    ]);
    return json({ activeBranchId: body.branchId });
  } catch (error) {
    return fail(error);
  }
}
