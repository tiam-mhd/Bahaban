import { escapeSpreadsheetCell } from "@/lib/domain";

export type ImportTemplateKind = "products" | "price_list";
export type ImportMappingKey =
  | "name"
  | "sku"
  | "barcode"
  | "brand"
  | "model"
  | "unit"
  | "price"
  | "costPrice"
  | "salePrice";

export const importTemplates: Record<
  ImportTemplateKind,
  {
    fileBaseName: string;
    sheetName: string;
    columns: { key: ImportMappingKey; header: string }[];
  }
> = {
  products: {
    fileBaseName: "bahaban-product-import-template",
    sheetName: "قالب کالا",
    columns: [
      { key: "name", header: "نام کالا" },
      { key: "sku", header: "کد کالا" },
      { key: "barcode", header: "بارکد" },
      { key: "brand", header: "برند" },
      { key: "model", header: "مدل" },
      { key: "unit", header: "واحد" },
      { key: "costPrice", header: "قیمت خرید فعلی" },
      { key: "salePrice", header: "قیمت فروش" },
    ],
  },
  price_list: {
    fileBaseName: "bahaban-price-list-import-template",
    sheetName: "قالب قیمت‌نامه",
    columns: [
      { key: "name", header: "نام کالا" },
      { key: "sku", header: "کد کالا" },
      { key: "barcode", header: "بارکد" },
      { key: "brand", header: "برند" },
      { key: "model", header: "مدل" },
      { key: "unit", header: "واحد" },
      { key: "price", header: "قیمت" },
    ],
  },
};

export function importTemplateHeaders(kind: ImportTemplateKind): string[] {
  return importTemplates[kind].columns.map((column) => column.header);
}

export function importTemplateCsv(kind: ImportTemplateKind): string {
  const headers = importTemplateHeaders(kind).map(escapeSpreadsheetCell).join(",");
  return `\uFEFF${headers}\r\n`;
}
