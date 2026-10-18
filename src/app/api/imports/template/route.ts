import ExcelJS from "exceljs";
import { ApiError, fail, requireBranch } from "@/lib/api";
import { attachmentHeaders } from "@/lib/exports";
import {
  importTemplateCsv,
  importTemplateHeaders,
  importTemplates,
  type ImportTemplateKind,
} from "@/lib/import-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireBranch(request);
    const search = new URL(request.url).searchParams;
    const kind = search.get("kind");
    const format = search.get("format") ?? "xlsx";
    if (kind !== "products" && kind !== "price_list")
      throw new ApiError(400, "نوع قالب ورود معتبر نیست.", "invalid_import_template");
    if (format !== "csv" && format !== "xlsx")
      throw new ApiError(400, "قالب فایل پشتیبانی نمی‌شود.", "invalid_import_template_format");

    const template = importTemplates[kind as ImportTemplateKind];
    const body =
      format === "csv"
        ? importTemplateCsv(kind as ImportTemplateKind)
        : Uint8Array.from(await createXlsxTemplate(kind as ImportTemplateKind));
    const contentType =
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    return new Response(body, {
      headers: attachmentHeaders(`${template.fileBaseName}.${format}`, contentType),
    });
  } catch (error) {
    return fail(error);
  }
}

async function createXlsxTemplate(kind: ImportTemplateKind): Promise<Buffer> {
  const template = importTemplates[kind];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "بهابان";
  const sheet = workbook.addWorksheet(template.sheetName, {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
  });

  const headers = importTemplateHeaders(kind);
  sheet.addRow(headers);
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF176A4C" },
  };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
  sheet.columns = headers.map((header, index) => ({
    key: `column${index + 1}`,
    width: Math.min(28, Math.max(16, header.length + 4)),
  }));

  const result = await workbook.xlsx.writeBuffer();
  return Buffer.from(result as unknown as ArrayBuffer);
}
