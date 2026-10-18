import { ApiError, fail, json, requireSameOrigin, requireBranch } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { transaction } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const scope = await requireBranch(request);
    const { id } = await context.params;
    await transaction(async (client) => {
      const list = await client.query<{ status: string }>(
        "SELECT status FROM price_lists WHERE id = $1 AND branch_id = $2 AND business_id = $3 FOR UPDATE",
        [id, scope.branchId, scope.businessId],
      );
      if (!list.rowCount)
        throw new ApiError(404, "قیمت‌نامه در این شعبه پیدا نشد.", "price_list_not_found");
      if (list.rows[0].status !== "in_review")
        throw new ApiError(409, "قیمت‌نامهٔ تأییدشده یا لغوشده قابل لغو نیست.", "price_list_closed");
      const approved = await client.query(
        "SELECT 1 FROM price_list_rows WHERE price_list_id = $1 AND branch_id = $2 AND approved_at IS NOT NULL LIMIT 1",
        [id, scope.branchId],
      );
      if (approved.rowCount)
        throw new ApiError(
          409,
          "قیمت‌نامه‌ای که بخشی از آن تأیید شده قابل لغو نیست.",
          "partially_approved",
        );
      await client.query(
        "UPDATE price_lists SET status = 'cancelled' WHERE id = $1 AND branch_id = $2",
        [id, scope.branchId],
      );
      await recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: "price_list.cancelled",
        entityType: "price_list",
        entityId: id,
        details: {},
      });
    });
    return json({ cancelled: true });
  } catch (error) {
    return fail(error);
  }
}
