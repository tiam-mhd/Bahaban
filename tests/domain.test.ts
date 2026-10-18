import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeSpreadsheetCell,
  markupSuggestedPrice,
  marginSuggestedPrice,
  normalizeDigits,
  normalizeIranianMobile,
  normalizeText,
  parseMoneyToRial,
  priceChangePercent,
  roundPrice,
} from "@/lib/domain";
import { findMatches, reviewWarnings, type ProductCandidate } from "@/lib/matching";

test("Iranian mobile numbers normalize to one E.164 form", () => {
  assert.equal(normalizeIranianMobile("۰۹۱۲ ۱۲۳ ۴۵۶۷"), "+989121234567");
  assert.equal(normalizeIranianMobile("00989121234567"), "+989121234567");
  assert.equal(normalizeIranianMobile("+989121234567"), "+989121234567");
  assert.throws(() => normalizeIranianMobile("02112345678"));
});

test("Persian text and digits normalize without losing the stored display value", () => {
  assert.equal(normalizeDigits("۱۲۳٤۵۶"), "123456");
  assert.equal(normalizeText("كالا‌ى  ۱۲۳"), "کالا ی 123");
});

test("money uses integer Rial and explicit Toman conversion", () => {
  assert.equal(parseMoneyToRial("۱٬۲۳۴", "IRT"), 12_340n);
  assert.equal(parseMoneyToRial("1,234", "IRR"), 1_234n);
  assert.throws(() => parseMoneyToRial("1.5", "IRT"));
  assert.throws(() => parseMoneyToRial("-10", "IRR"));
  assert.throws(() => parseMoneyToRial("1.5", "IRR"));
  assert.equal(parseMoneyToRial("9223372036854775807", "IRR"), 9_223_372_036_854_775_807n);
  assert.throws(() => parseMoneyToRial("922337203685477581", "IRT"));
});

test("gross margin and markup formulas remain distinct and round in integers", () => {
  assert.equal(marginSuggestedPrice(10_000n, 2_000), 12_500n);
  assert.equal(markupSuggestedPrice(10_000n, 2_000), 12_000n);
  assert.equal(roundPrice(12_490n, 1_000n), 12_000n);
  assert.equal(roundPrice(12_510n, 1_000n), 13_000n);
  assert.equal(priceChangePercent(10_000n, 12_500n), 25);
});

test("spreadsheet text is quoted and formula prefixes are neutralized", () => {
  assert.equal(escapeSpreadsheetCell("=HYPERLINK(1)"), '"\'=HYPERLINK(1)"');
  assert.equal(escapeSpreadsheetCell("نام، کالا"), '"نام، کالا"');
  assert.equal(escapeSpreadsheetCell('نام "ویژه"'), '"نام ""ویژه"""');
});

test("matching prefers exact barcode, then exact SKU, then ranked name suggestions", () => {
  const products: ProductCandidate[] = [
    {
      id: "one",
      name: "چراغ مطالعه مدل A",
      sku: "L-01",
      barcode: "6260001",
      brand: "نور",
      model: "A",
      unit: "عدد",
      cost_price_rial: "10000",
      sale_price_rial: "14000",
      version: 1,
    },
    {
      id: "two",
      name: "چراغ مطالعه مدل B",
      sku: "L-02",
      barcode: "6260002",
      brand: "نور",
      model: "B",
      unit: "عدد",
      cost_price_rial: "11000",
      sale_price_rial: null,
      version: 1,
    },
  ];
  assert.deepEqual(
    findMatches(
      { name: "متن متفاوت", sku: "L-02", barcode: "6260001", brand: "", model: "" },
      products,
    )[0],
    { productId: "one", confidence: 100, method: "barcode" },
  );
  assert.deepEqual(
    findMatches(
      { name: "متن متفاوت", sku: "L-02", barcode: "", brand: "", model: "" },
      products,
    )[0],
    { productId: "two", confidence: 99, method: "sku" },
  );
  const fuzzy = findMatches(
    { name: "چراغ مطالعه مدل", sku: "", barcode: "", brand: "نور", model: "A" },
    products,
  );
  assert.ok(fuzzy.length > 0);
  assert.equal(fuzzy[0].method, "name");
  assert.equal(fuzzy[0].confidence < 100, true);
});

test("review warnings keep duplicates, invalid prices and abnormal changes visible", () => {
  assert.deepEqual(
    reviewWarnings({
      name: "",
      unit: "",
      price: null,
      previousPrice: null,
      duplicate: true,
      confidence: 70,
    }),
    ["missing_name", "missing_unit", "invalid_price", "duplicate_in_file", "ambiguous_match"],
  );
  assert.ok(
    reviewWarnings({
      name: "کالا",
      unit: "عدد",
      price: 200n,
      previousPrice: 100n,
      duplicate: false,
      confidence: 100,
    }).includes("large_price_change"),
  );
  assert.ok(
    reviewWarnings({
      name: "کالا",
      unit: "بسته",
      productUnit: "عدد",
      price: 100n,
      previousPrice: null,
      duplicate: false,
      confidence: 0,
    }).includes("unit_mismatch"),
  );
  assert.ok(
    reviewWarnings({
      name: "کالا",
      unit: "عدد",
      price: 100n,
      previousPrice: null,
      duplicate: false,
      confidence: 0,
    }).includes("unmatched_product"),
  );
});
