import { normalizeText } from "@/lib/domain";

export type ProductCandidate = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  brand: string;
  model: string;
  unit: string;
  cost_price_rial: string | null;
  sale_price_rial: string | null;
  version: number;
};

export type MatchInput = {
  name: string;
  sku: string;
  barcode: string;
  brand: string;
  model: string;
};
export type MatchCandidate = {
  productId: string;
  confidence: number;
  method: "barcode" | "sku" | "name";
};

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  const max = Math.max(left.length, right.length);
  return Math.round((1 - editDistance(left, right) / max) * 100);
}

function combinedName(input: MatchInput): string {
  return normalizeText([input.name, input.brand, input.model].filter(Boolean).join(" "));
}

export function findMatches(
  input: MatchInput,
  products: ProductCandidate[],
  max = 3,
): MatchCandidate[] {
  const barcode = normalizeText(input.barcode);
  if (barcode) {
    const exact = products.filter(
      (product) => product.barcode && normalizeText(product.barcode) === barcode,
    );
    if (exact.length)
      return exact
        .slice(0, max)
        .map((product) => ({ productId: product.id, confidence: 100, method: "barcode" }));
  }
  const sku = normalizeText(input.sku);
  if (sku) {
    const exact = products.filter((product) => product.sku && normalizeText(product.sku) === sku);
    if (exact.length)
      return exact
        .slice(0, max)
        .map((product) => ({ productId: product.id, confidence: 99, method: "sku" }));
  }
  const label = combinedName(input);
  if (!label) return [];
  return products
    .map((product) => {
      const productLabel = combinedName({
        name: product.name,
        brand: product.brand,
        model: product.model,
        sku: "",
        barcode: "",
      });
      return {
        productId: product.id,
        confidence: similarity(label, productLabel),
        method: "name" as const,
      };
    })
    .filter((candidate) => candidate.confidence >= 55)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, max);
}

export function reviewWarnings(input: {
  name: string;
  unit: string;
  productUnit?: string;
  price: bigint | null;
  previousPrice: bigint | null;
  duplicate: boolean;
  confidence: number;
}): string[] {
  const warnings: string[] = [];
  if (!input.name.trim()) warnings.push("missing_name");
  if (!input.unit.trim()) warnings.push("missing_unit");
  if (
    input.unit.trim() &&
    input.productUnit?.trim() &&
    normalizeText(input.unit) !== normalizeText(input.productUnit)
  )
    warnings.push("unit_mismatch");
  if (input.price === null) warnings.push("invalid_price");
  else if (input.price === 0n) warnings.push("zero_price");
  if (input.duplicate) warnings.push("duplicate_in_file");
  if (input.confidence === 0) warnings.push("unmatched_product");
  if (input.confidence > 0 && input.confidence < 90) warnings.push("ambiguous_match");
  if (input.previousPrice !== null && input.previousPrice > 0n && input.price !== null) {
    const difference =
      input.price > input.previousPrice
        ? input.price - input.previousPrice
        : input.previousPrice - input.price;
    if (difference * 100n > input.previousPrice * 50n) warnings.push("large_price_change");
  }
  return warnings;
}
