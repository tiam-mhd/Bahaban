import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseUpload } from "@/lib/imports";

test("CSV parsing preserves quoted commas and rejects malformed quoting", async () => {
  const file = new File(['نام کالا,قیمت,واحد\r\n"پیچ، چهارسو",۱٬۲۰۰,عدد\r\n'], "supplier.csv", {
    type: "text/csv",
  });
  const parsed = await parseUpload(file);
  assert.deepEqual(parsed.headers, ["نام کالا", "قیمت", "واحد"]);
  assert.deepEqual(parsed.rows[0], ["پیچ، چهارسو", "۱٬۲۰۰", "عدد"]);
  const malformed = new File(['نام,قیمت\n"کالای ناقص,120'], "broken.csv", { type: "text/csv" });
  await assert.rejects(parseUpload(malformed), /نقل‌قول/);
});

test("XLSX parsing reads the first worksheet and checks its ZIP signature", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("قیمت");
  sheet.addRow(["کد کالا", "نام کالا", "قیمت"]);
  sheet.addRow(["A-1", "کالای نمونه", 1250]);
  const bytes = await workbook.xlsx.writeBuffer();
  const parsed = await parseUpload(new File([bytes], "price.xlsx"));
  assert.deepEqual(parsed.headers, ["کد کالا", "نام کالا", "قیمت"]);
  assert.deepEqual(parsed.rows[0], ["A-1", "کالای نمونه", "1250"]);
  await assert.rejects(parseUpload(new File(["not an excel file"], "bad.xlsx")), /سازگار نیست/);
});
