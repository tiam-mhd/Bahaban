import ExcelJS from "exceljs";
import { escapeSpreadsheetCell, isSpreadsheetFormula } from "@/lib/domain";

export type ExportRow = {
  sku: string;
  name: string;
  unit: string;
  price: string;
  currency: string;
  date: string;
  supplier: string;
};

const headings = ["کد کالا", "نام کالا", "واحد", "قیمت (ریال)", "واحد پول", "تاریخ", "تأمین‌کننده"];

export function toCsv(rows: ExportRow[]): string {
  const lines = [
    headings,
    ...rows.map((row) => [
      row.sku,
      row.name,
      row.unit,
      row.price,
      row.currency,
      row.date,
      row.supplier,
    ]),
  ];
  return `\uFEFF${lines.map((line) => line.map((cell) => escapeSpreadsheetCell(String(cell))).join(",")).join("\r\n")}`;
}

export async function toXlsx(rows: ExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "بهابان";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("خروجی عمومی", { views: [{ rightToLeft: true }] });
  sheet.addRow(headings);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(
      [row.sku, row.name, row.unit, row.price, row.currency, row.date, row.supplier].map((cell) => {
        const text = String(cell);
        return isSpreadsheetFormula(text) ? `'${text}` : text;
      }),
    );
  }
  sheet.columns.forEach((column) => {
    column.width = Math.min(36, Math.max(14, column.header?.length ?? 16));
  });
  const result = await workbook.xlsx.writeBuffer();
  return Buffer.from(result);
}

export function attachmentHeaders(fileName: string, contentType: string): HeadersInit {
  const encodedName = encodeURIComponent(fileName);
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="bahaban-export"; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
