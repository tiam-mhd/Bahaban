export type Section =
  | "overview"
  | "products"
  | "categories"
  | "suppliers"
  | "imports"
  | "review"
  | "history"
  | "settings";
export type Branch = { id: string; name: string; isPrimary: boolean };
export type Business = { id: string; name: string; role: "owner" | "member"; branches: Branch[] };
export type SessionData = {
  authenticated: boolean;
  user?: { phone: string };
  businesses?: Business[];
  activeBranch?: {
    id: string;
    name: string;
    isPrimary: boolean;
    businessId: string;
    businessName: string;
  } | null;
};
export type Product = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  brand: string;
  model: string;
  unit: string;
  cost_price_rial: string | null;
  sale_price_rial: string | null;
  is_active: boolean;
  version: number;
  created_at: string;
};
export type ProductCategory = {
  id: string;
  name: string;
  description: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  product_count: number;
  child_count: number;
};
export type Supplier = { id: string; name: string; note: string; created_at: string };
export type PriceList = {
  id: string;
  title: string;
  source_file_name: string;
  source_date: string;
  currency: "IRR" | "IRT";
  status: "in_review" | "approved" | "cancelled" | "error";
  row_count: number;
  created_at: string;
  approved_at: string | null;
  supplier_name: string;
  approved_rows: number;
  skipped_rows: number;
  pending_rows: number;
};
export type Suggestion = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  costPrice: string | null;
  confidence: number;
  method: "barcode" | "sku" | "name";
};
export type PriceRow = {
  id: string;
  source_row: number;
  source_name: string;
  source_sku: string;
  source_barcode: string;
  source_brand: string;
  source_model: string;
  source_unit: string;
  price_rial: string | null;
  previous_price_rial: string | null;
  expected_product_version: number | null;
  matched_product_id: string | null;
  match_method: string;
  confidence: number;
  warning_codes: string[];
  reviewed: boolean;
  skipped: boolean;
  approved_at: string | null;
  matched_product_name: string | null;
  matched_product_sku: string | null;
  matched_product_unit: string | null;
  current_cost_rial: string | null;
  current_sale_rial: string | null;
  suggestions: Suggestion[];
};
export type PriceListDetail = Omit<PriceList, "approved_rows" | "skipped_rows" | "pending_rows">;
export type HistoryEvent = {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};
export type BranchSettings = {
  margin_rate_bps: number;
  markup_rate_bps: number;
  rounding_step: string;
  currency: "IRR";
};
export type BranchAppearance = {
  mode: "light" | "dark";
  accentColor: string;
  fontFamily: "vazirmatn" | "system";
};
