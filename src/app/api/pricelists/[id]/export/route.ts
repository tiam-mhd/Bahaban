import { ApiError, fail, requireBranch } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { transaction, query } from "@/lib/db";
import { attachmentHeaders, toCsv, toXlsx, type ExportRow } from "@/lib/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireBranch(request);
    const { id } = await context.params;
    const format = new URL(request.url).searchParams.get("format") ?? "csv";
    if (format !== "csv" && format !== "xlsx")
      throw new ApiError(400, "قالب خروجی پشتیبانی نمی‌شود.", "invalid_export_format");
    const result = await query<ExportRow & { source_date: string; supplier_name: string }>(
      `SELECT p.sku, p.name, p.unit, r.price_rial::text AS price, l.currency,
        l.source_date::text AS source_date, s.name AS supplier_name
       FROM price_list_rows r JOIN price_lists l ON l.id = r.price_list_id AND l.branch_id = r.branch_id
       JOIN products p ON p.id = r.matched_product_id AND p.branch_id = r.branch_id
       JOIN suppliers s ON s.id = l.supplier_id AND s.branch_id = l.branch_id
       WHERE l.id = $1 AND l.branch_id = $2 AND l.business_id = $3 AND l.status = 'approved'
         AND r.approved_at IS NOT NULL ORDER BY r.source_row`,
      [id, scope.branchId, scope.businessId],
    );
    if (!result.rowCount) {
      const list = await query(
        "SELECT 1 FROM price_lists WHERE id = $1 AND branch_id = $2 AND business_id = $3 AND status = 'approved'",
        [id, scope.branchId, scope.businessId],
      );
      if (!list.rowCount)
        throw new ApiError(
          409,
          "خروجی بعد از تأیید کامل قیمت‌نامه در دسترس است.",
          "export_not_ready",
        );
    }
    const rows = result.rows.map((row) => ({
      sku: row.sku,
      name: row.name,
      unit: row.unit,
      price: row.price,
      currency: row.currency === "IRT" ? "ریال (تبدیل‌شده از تومان)" : "ریال",
      date: row.source_date,
      supplier: row.supplier_name,
    }));
    await transaction((client) =>
      recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: "price_list.exported",
        entityType: "price_list",
        entityId: id,
        details: { format, rows: rows.length },
      }),
    );
    const body = format === "csv" ? toCsv(rows) : Uint8Array.from(await toXlsx(rows));
    const contentType =
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return new Response(body, {
      headers: attachmentHeaders(`bahaban-${id}.${format}`, contentType),
    });
  } catch (error) {
    return fail(error);
  }
}
