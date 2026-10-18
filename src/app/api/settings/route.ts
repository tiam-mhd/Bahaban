import { ApiError, fail, json, readJson, requireSameOrigin, requireBranch } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { transaction, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = await requireBranch(request);
    const result = await query(
      `SELECT margin_rate_bps, markup_rate_bps, rounding_step::text AS rounding_step, currency
       FROM branch_settings WHERE branch_id = $1 AND business_id = $2`,
      [scope.branchId, scope.businessId],
    );
    if (!result.rowCount)
      throw new ApiError(404, "تنظیمات این شعبه پیدا نشد.", "settings_not_found");
    return json(result.rows[0]);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    requireSameOrigin(request);
    const scope = await requireBranch(request);
    const body = await readJson<Record<string, unknown>>(request);
    const margin = Number(body.marginRateBps);
    const markup = Number(body.markupRateBps);
    if (typeof body.roundingStep !== "string" && typeof body.roundingStep !== "number")
      throw new ApiError(400, "گام گردکردن معتبر نیست.", "invalid_settings");
    let rounding: bigint;
    try {
      if (typeof body.roundingStep === "string" && !/^\d+$/.test(body.roundingStep))
        throw new Error("invalid rounding");
      rounding = BigInt(body.roundingStep);
    } catch {
      throw new ApiError(400, "گام گردکردن معتبر نیست.", "invalid_settings");
    }
    if (
      !Number.isInteger(margin) ||
      margin < 0 ||
      margin > 9_500 ||
      !Number.isInteger(markup) ||
      markup < 0 ||
      markup > 10_000 ||
      rounding <= 0n ||
      rounding > 10_000_000_000n
    ) {
      throw new ApiError(400, "تنظیمات قیمت معتبر نیست.", "invalid_settings");
    }
    await transaction(async (client) => {
      await client.query(
        `UPDATE branch_settings SET margin_rate_bps = $1, markup_rate_bps = $2, rounding_step = $3, updated_at = now()
         WHERE branch_id = $4 AND business_id = $5`,
        [margin, markup, rounding.toString(), scope.branchId, scope.businessId],
      );
      await recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: "branch.settings_updated",
        entityType: "branch",
        entityId: scope.branchId,
        details: {
          marginRateBps: margin,
          markupRateBps: markup,
          roundingStep: rounding.toString(),
        },
      });
    });
    return json({ saved: true });
  } catch (error) {
    return fail(error);
  }
}
