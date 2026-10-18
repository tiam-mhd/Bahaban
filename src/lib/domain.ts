const digitMap: Record<string, string> = {
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

export function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => digitMap[digit] ?? digit);
}

export function normalizeText(value: string): string {
  return normalizeDigits(value)
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\u200c\u200d]/g, " ")
    .replace(/[\u00a0\s]+/g, " ")
    .trim()
    .toLocaleLowerCase("fa-IR");
}

export function normalizeIranianMobile(input: string): string {
  let value = normalizeDigits(input).replace(/[\s().-]/g, "");
  if (value.startsWith("0098")) value = `+98${value.slice(4)}`;
  if (value.startsWith("98")) value = `+${value}`;
  if (value.startsWith("09")) value = `+98${value.slice(1)}`;
  if (!/^\+989\d{9}$/.test(value)) throw new Error("شمارهٔ موبایل ایران معتبر نیست.");
  return value;
}

export function parseMoneyToRial(input: unknown, currency: "IRR" | "IRT"): bigint {
  if (typeof input !== "string" && typeof input !== "number" && typeof input !== "bigint") {
    throw new Error("قیمت معتبر نیست.");
  }
  const raw = normalizeDigits(String(input))
    .replace(/[\s٬,،]/g, "")
    .replace(/٫/g, ".")
    .trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("قیمت باید عدد صحیح مثبت یا صفر باشد.");
  const [whole, fraction = ""] = raw.split(".");
  const base = BigInt(whole);
  if (currency === "IRT") {
    if (fraction) throw new Error("قیمت تومان باید عدد صحیح باشد.");
    const rial = base * 10n;
    if (rial > 9_223_372_036_854_775_807n) throw new Error("قیمت از محدودهٔ قابل ذخیره بیشتر است.");
    return rial;
  }
  if (fraction) throw new Error("قیمت ریالی باید عدد صحیح باشد.");
  if (base > 9_223_372_036_854_775_807n) throw new Error("قیمت از محدودهٔ قابل ذخیره بیشتر است.");
  return base;
}

export function formatRial(value: bigint | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("fa-IR").format(BigInt(value));
}

export function marginSuggestedPrice(costRial: bigint, marginBps: number): bigint {
  if (marginBps < 0 || marginBps >= 10_000) throw new Error("حاشیهٔ سود خارج از بازه است.");
  return (costRial * 10_000n + BigInt(10_000 - marginBps) / 2n) / BigInt(10_000 - marginBps);
}

export function markupSuggestedPrice(costRial: bigint, markupBps: number): bigint {
  if (markupBps < 0 || markupBps > 10_000) throw new Error("درصد افزایش خارج از بازه است.");
  return (costRial * BigInt(10_000 + markupBps) + 5_000n) / 10_000n;
}

export function roundPrice(value: bigint, step: bigint): bigint {
  if (step <= 0n) throw new Error("گام گردکردن معتبر نیست.");
  return ((value + step / 2n) / step) * step;
}

export function isSpreadsheetFormula(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character.trim() === "" || codePoint < 0x20 || codePoint === 0x7f) continue;
    return "=+-@".includes(character);
  }
  return false;
}

export function escapeSpreadsheetCell(value: string): string {
  const guarded = isSpreadsheetFormula(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function grossMarginPercent(cost: bigint, sale: bigint): number | null {
  if (sale <= 0n) return null;
  return Number(((sale - cost) * 10_000n) / sale) / 100;
}

export function priceChangePercent(previous: bigint | null, next: bigint): number | null {
  if (previous === null || previous === 0n) return null;
  return Number(((next - previous) * 10_000n) / previous) / 100;
}
