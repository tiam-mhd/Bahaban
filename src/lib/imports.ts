import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api";
import { normalizeText } from "@/lib/domain";

const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const runtimeEnv = process.env;
const configuredUploadBytes = runtimeEnv.MAX_UPLOAD_BYTES;
export const MAX_UPLOAD_BYTES = (() => {
  if (!configuredUploadBytes) return DEFAULT_MAX_UPLOAD_BYTES;
  const value = Number(configuredUploadBytes);
  if (!Number.isSafeInteger(value) || value < 1024 * 1024 || value > 10 * 1024 * 1024) {
    throw new Error("MAX_UPLOAD_BYTES must be an integer between 1048576 and 10485760.");
  }
  return value;
})();
export const MAX_IMPORT_ROWS = 2_000;
export const MAX_IMPORT_COLUMNS = 80;

export type ParsedSheet = {
  headers: string[];
  rows: string[][];
  fileHash: string;
  fileName: string;
};

function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const delimiter = semicolons > commas ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      if (row.length > MAX_IMPORT_COLUMNS)
        throw new ApiError(413, "فایل بیش از ۸۰ ستون دارد.", "too_many_columns");
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      if (rows.length > MAX_IMPORT_ROWS + 1)
        throw new ApiError(413, "فایل بیش از ۲۰۰۰ ردیف دارد.", "too_many_rows");
    } else cell += char;
    if (cell.length > 2_000)
      throw new ApiError(400, "یکی از خانه‌های فایل بیش از حد طولانی است.", "cell_too_long");
  }
  if (quoted) throw new ApiError(400, "ساختار نقل‌قول در فایل CSV کامل نیست.", "bad_csv");
  row.push(cell);
  if (row.length > MAX_IMPORT_COLUMNS)
    throw new ApiError(413, "فایل بیش از ۸۰ ستون دارد.", "too_many_columns");
  if (row.some((item) => item.trim() !== "")) rows.push(row);
  return rows;
}

function inspectZip(buffer: Buffer<ArrayBuffer>): void {
  const start = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ApiError(400, "ساختار فایل Excel معتبر نیست.", "bad_xlsx");
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries < 1 || entries > 500 || centralOffset + centralSize > buffer.length) {
    throw new ApiError(400, "ساختار فایل Excel معتبر نیست.", "bad_xlsx");
  }
  let cursor = centralOffset;
  let expandedBytes = 0;
  for (let entry = 0; entry < entries; entry += 1) {
    if (
      cursor + 46 > centralOffset + centralSize ||
      cursor + 46 > buffer.length ||
      buffer.readUInt32LE(cursor) !== 0x02014b50
    ) {
      throw new ApiError(400, "ساختار فایل Excel معتبر نیست.", "bad_xlsx");
    }
    const expanded = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    expandedBytes += expanded;
    if (expanded > 12 * 1024 * 1024 || expandedBytes > 32 * 1024 * 1024) {
      throw new ApiError(
        413,
        "اندازهٔ محتوای بازشدهٔ فایل Excel بیش از حد مجاز است.",
        "xlsx_too_large",
      );
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
}

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("result" in value) return cellText(value.result);
  return "";
}

function fileDisplayName(name: string): string {
  const clean = Array.from(name, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "\\" || character === "/" || codePoint < 0x20 || codePoint === 0x7f
      ? "_"
      : character;
  })
    .join("")
    .trim()
    .slice(0, 240);
  return clean || "فایل واردشده";
}

export async function parseUpload(file: File): Promise<ParsedSheet> {
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES)
    throw new ApiError(413, "حجم فایل از حد مجاز سامانه بیشتر است.", "upload_size");
  const name = fileDisplayName(file.name);
  const extension = name.toLowerCase().split(".").pop();
  const buffer = Buffer.from(await file.arrayBuffer());
  let table: string[][];

  if (extension === "csv") {
    if (buffer.includes(0)) throw new ApiError(400, "فایل CSV معتبر نیست.", "bad_csv");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
    } catch {
      throw new ApiError(400, "فایل CSV باید با رمزگذاری UTF-8 ذخیره شده باشد.", "bad_encoding");
    }
    table = parseCsv(text);
  } else if (extension === "xlsx") {
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
      throw new ApiError(400, "محتوای فایل با قالب XLSX سازگار نیست.", "bad_xlsx");
    }
    inspectZip(buffer);
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("empty workbook");
      table = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        if (table.length > MAX_IMPORT_ROWS)
          throw new ApiError(413, "فایل بیش از ۲۰۰۰ ردیف دارد.", "too_many_rows");
        const values: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell, column) => {
          if (column > MAX_IMPORT_COLUMNS)
            throw new ApiError(413, "فایل بیش از ۸۰ ستون دارد.", "too_many_columns");
          values[column - 1] = cellText(cell.value);
        });
        table.push(values);
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "فایل Excel قابل خواندن نیست.", "bad_xlsx");
    }
  } else {
    throw new ApiError(415, "فقط فایل CSV و XLSX پشتیبانی می‌شود.", "unsupported_file");
  }

  if (table.length - 1 > MAX_IMPORT_ROWS)
    throw new ApiError(413, "فایل بیش از ۲۰۰۰ ردیف دارد.", "too_many_rows");
  const headers = (table.shift() ?? []).map((item) => item.trim().slice(0, 120));
  if (!headers.length || headers.length > MAX_IMPORT_COLUMNS)
    throw new ApiError(400, "ردیف عنوان ستون‌ها معتبر نیست.", "invalid_headers");
  const normalizedHeaders = headers.map(normalizeText);
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length)
    throw new ApiError(
      400,
      "عنوان یکی از ستون‌ها تکراری است. فایل را اصلاح کنید.",
      "duplicate_headers",
    );
  const rows = table
    .slice(0, MAX_IMPORT_ROWS)
    .map((row) =>
      Array.from({ length: headers.length }, (_, index) =>
        String(row[index] ?? "").slice(0, 2_000),
      ),
    );
  if (!rows.length) throw new ApiError(400, "فایل ردیفی برای ورود ندارد.", "empty_file");
  return {
    headers,
    rows,
    fileHash: createHash("sha256").update(buffer).digest("hex"),
    fileName: name,
  };
}

export function mappedCell(row: string[], headers: string[], field: string | undefined): string {
  if (!field) return "";
  const column = headers.indexOf(field);
  return column < 0 ? "" : (row[column] ?? "");
}
