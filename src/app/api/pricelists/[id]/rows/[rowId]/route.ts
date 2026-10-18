import { ApiError, fail, json, readJson, requireSameOrigin, requireBranch } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { transaction } from "@/lib/db";
import { normalizeText, parseMoneyToRial } from "@/lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; rowId: string }> },
) {
  try {
    requireSameOrigin(request);
    const scope = await requireBranch(request);
    const { id, rowId } = await context.params;
    const body = await readJson<{
      productId?: unknown;
      skip?: unknown;
      reviewed?: unknown;
      name?: unknown;
      price?: unknown;
      unit?: unknown;
    }>(request);
    if (body.reviewed !== true)
      throw new ApiError(400, "برای ادامه، ردیف را صریحاً بازبینی کنید.", "review_required");
    const result = await transaction(async (client) => {
      const list = await client.query<{ status: string; currency: "IRR" | "IRT" }>(
        "SELECT status, currency FROM price_lists WHERE id = $1 AND branch_id = $2 AND business_id = $3 FOR UPDATE",
        [id, scope.branchId, scope.businessId],
      );
      if (!list.rowCount)
        throw new ApiError(404, "قیمت‌نامه در این شعبه پیدا نشد.", "price_list_not_found");
      if (list.rows[0].status !== "in_review")
        throw new ApiError(409, "این قیمت‌نامه دیگر قابل ویرایش نیست.", "price_list_closed");
      const row = await client.query<{ price_rial: string | null; warning_codes: string[] }>(
        `SELECT price_rial::text AS price_rial, warning_codes FROM price_list_rows
         WHERE id = $1 AND price_list_id = $2 AND branch_id = $3 AND business_id = $4 AND approved_at IS NULL FOR UPDATE`,
        [rowId, id, scope.branchId, scope.businessId],
      );
      if (!row.rowCount) throw new ApiError(404, "ردیف قیمت‌نامه پیدا نشد.", "row_not_found");
      if (body.skip === true) {
        await client.query(
          "UPDATE price_list_rows SET skipped = true, reviewed = true WHERE id = $1",
          [rowId],
        );
        await client.query(
          `UPDATE price_list_rows r SET warning_codes = array_remove(r.warning_codes, 'duplicate_product_in_review')
           WHERE r.price_list_id = $1 AND r.branch_id = $2 AND r.approved_at IS NULL`,
          [id, scope.branchId],
        );
        await client.query(
          `UPDATE price_list_rows r SET warning_codes = array_append(r.warning_codes, 'duplicate_product_in_review')
           WHERE r.price_list_id = $1 AND r.branch_id = $2 AND r.approved_at IS NULL AND NOT r.skipped AND r.matched_product_id IS NOT NULL
             AND (SELECT count(*) FROM price_list_rows other WHERE other.price_list_id = r.price_list_id AND other.branch_id = r.branch_id
               AND other.matched_product_id = r.matched_product_id AND other.approved_at IS NULL AND NOT other.skipped) > 1`,
          [id, scope.branchId],
        );
        await recordAudit(client, {
          businessId: scope.businessId,
          branchId: scope.branchId,
          actorId: scope.id,
          eventType: "price_list.row_skipped",
          entityType: "price_list_row",
          entityId: rowId,
          details: { priceListId: id },
        });
        return { id: rowId, skipped: true };
      }
      if (typeof body.productId !== "string")
        throw new ApiError(
          400,
          "کالای متناظر را انتخاب کنید یا ردیف را کنار بگذارید.",
          "missing_product_match",
        );
      const product = await client.query<{
        cost_price_rial: string | null;
        version: number;
        unit: string;
      }>(
        `SELECT cost_price_rial::text AS cost_price_rial, version, unit FROM products
         WHERE id = $1 AND branch_id = $2 AND business_id = $3 AND archived_at IS NULL AND is_active FOR UPDATE`,
        [body.productId, scope.branchId, scope.businessId],
      );
      if (!product.rowCount)
        throw new ApiError(404, "کالا در این شعبه پیدا نشد.", "product_not_found");
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
      const unit = typeof body.unit === "string" ? body.unit.trim().slice(0, 50) : "";
      if (!name) throw new ApiError(400, "نام کالا در ردیف خالی است.", "missing_item_name");
      let price = row.rows[0].price_rial;
      if (body.price !== undefined) {
        if (typeof body.price !== "string" && typeof body.price !== "number")
          throw new ApiError(400, "قیمت معتبر نیست.", "invalid_price");
        price = parseMoneyToRial(body.price, list.rows[0].currency).toString();
      }
      if (price === null)
        throw new ApiError(400, "قیمت را اصلاح کنید تا ردیف قابل بازبینی شود.", "invalid_price");
      const warnings = row.rows[0].warning_codes.filter(
        (warning) =>
          ![
            "missing_name",
            "missing_unit",
            "invalid_price",
            "ambiguous_match",
            "zero_price",
            "large_price_change",
            "duplicate_product_in_review",
            "unit_mismatch",
            "unmatched_product",
          ].includes(warning),
      );
      if (!unit) warnings.push("missing_unit");
      else if (product.rows[0].unit && normalizeText(product.rows[0].unit) !== normalizeText(unit))
        warnings.push("unit_mismatch");
      if (BigInt(price) === 0n) warnings.push("zero_price");
      const previous = product.rows[0].cost_price_rial
        ? BigInt(product.rows[0].cost_price_rial)
        : null;
      if (previous !== null && previous > 0n) {
        const difference =
          BigInt(price) > previous ? BigInt(price) - previous : previous - BigInt(price);
        if (difference * 100n > previous * 50n) warnings.push("large_price_change");
      }
      const duplicate = await client.query(
        `SELECT 1 FROM price_list_rows WHERE price_list_id = $1 AND branch_id = $2 AND matched_product_id = $3 AND id <> $4
          AND approved_at IS NULL AND NOT skipped LIMIT 1`,
        [id, scope.branchId, body.productId, rowId],
      );
      if (duplicate.rowCount) warnings.push("duplicate_product_in_review");
      await client.query(
        `UPDATE price_list_rows SET source_name = $1, source_unit = $2, price_rial = $3,
          previous_price_rial = $4, expected_product_version = $5, matched_product_id = $6,
          match_method = 'manual', confidence = 100, warning_codes = $7, reviewed = true, skipped = false
         WHERE id = $8`,
        [
          name,
          unit,
          price,
          previous?.toString() ?? null,
          product.rows[0].version,
          body.productId,
          warnings,
          rowId,
        ],
      );
      await client.query(
        `UPDATE price_list_rows r SET warning_codes = array_remove(r.warning_codes, 'duplicate_product_in_review')
         WHERE r.price_list_id = $1 AND r.branch_id = $2 AND r.approved_at IS NULL`,
        [id, scope.branchId],
      );
      await client.query(
        `UPDATE price_list_rows r SET warning_codes = array_append(r.warning_codes, 'duplicate_product_in_review')
         WHERE r.price_list_id = $1 AND r.branch_id = $2 AND r.approved_at IS NULL AND r.matched_product_id IS NOT NULL
           AND (SELECT count(*) FROM price_list_rows other WHERE other.price_list_id = r.price_list_id AND other.branch_id = r.branch_id
             AND other.matched_product_id = r.matched_product_id AND other.approved_at IS NULL AND NOT other.skipped) > 1`,
        [id, scope.branchId],
      );
      const refreshed = await client.query<{ warning_codes: string[] }>(
        "SELECT warning_codes FROM price_list_rows WHERE id = $1 AND branch_id = $2",
        [rowId, scope.branchId],
      );
      await recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: "price_list.row_reviewed",
        entityType: "price_list_row",
        entityId: rowId,
        details: { priceListId: id, productId: body.productId, proposedPriceRial: price },
      });
      return { id: rowId, reviewed: true, warnings: refreshed.rows[0].warning_codes };
    });
    return json(result);
  } catch (error) {
    return fail(error);
  }
}
