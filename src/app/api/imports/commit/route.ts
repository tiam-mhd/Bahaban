import { ApiError, fail, json, readJson, requireSameOrigin, requireBranch } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { transaction, query } from "@/lib/db";
import { normalizeText, parseMoneyToRial } from "@/lib/domain";
import { MAX_IMPORT_ROWS, mappedCell } from "@/lib/imports";
import {
  findMatches,
  reviewWarnings,
  type ProductCandidate,
  type MatchCandidate,
} from "@/lib/matching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Mapping = Partial<
  Record<
    "name" | "sku" | "barcode" | "brand" | "model" | "unit" | "price" | "costPrice" | "salePrice",
    string
  >
>;
type Body = {
  draftId?: unknown;
  mapping?: unknown;
  currency?: unknown;
  supplierId?: unknown;
  title?: unknown;
  sourceDate?: unknown;
};

function valuesSql(rows: unknown[][]): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const clauses = rows.map(
    (row) =>
      `(${row
        .map((value) => {
          values.push(value);
          return `$${values.length}`;
        })
        .join(",")})`,
  );
  return { sql: clauses.join(","), values };
}

function validMapping(value: unknown, headers: string[]): Mapping {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "نگاشت ستون‌ها معتبر نیست.", "invalid_mapping");
  const input = value as Record<string, unknown>;
  const mapping: Mapping = {};
  for (const field of [
    "name",
    "sku",
    "barcode",
    "brand",
    "model",
    "unit",
    "price",
    "costPrice",
    "salePrice",
  ] as const) {
    const header = input[field];
    if (header === undefined || header === null || header === "") continue;
    if (typeof header !== "string" || !headers.includes(header))
      throw new ApiError(400, "یکی از ستون‌های انتخاب‌شده در فایل وجود ندارد.", "invalid_mapping");
    mapping[field] = header;
  }
  if (!mapping.name)
    throw new ApiError(400, "ستون نام کالا را انتخاب کنید.", "missing_name_mapping");
  return mapping;
}

function cell(row: string[], headers: string[], mapping: Mapping, key: keyof Mapping): string {
  return mappedCell(row, headers, mapping[key]);
}

function optionalPrice(value: string, currency: "IRR" | "IRT"): string | null {
  return value.trim() ? parseMoneyToRial(value, currency).toString() : null;
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const scope = await requireBranch(request);
    const body = await readJson<Body>(request);
    if (typeof body.draftId !== "string")
      throw new ApiError(
        400,
        "پیش‌نمایش فایل منقضی شده است. دوباره فایل را انتخاب کنید.",
        "draft_missing",
      );
    const draftResult = await query<{
      id: string;
      kind: "products" | "price_list";
      file_name: string;
      file_hash: string;
      parsed_rows: string[][];
      headers: string[];
    }>(
      `SELECT id, kind, file_name, file_hash, parsed_rows, headers FROM import_drafts
       WHERE id = $1 AND user_id = $2 AND branch_id = $3 AND business_id = $4 AND expires_at > now()`,
      [body.draftId, scope.id, scope.branchId, scope.businessId],
    );
    if (!draftResult.rowCount)
      throw new ApiError(
        404,
        "پیش‌نمایش فایل منقضی شده است. دوباره فایل را انتخاب کنید.",
        "draft_expired",
      );
    const draft = draftResult.rows[0];
    const mapping = validMapping(body.mapping, draft.headers);
    if (draft.kind === "price_list" && !mapping.price)
      throw new ApiError(400, "ستون قیمت را انتخاب کنید.", "missing_price_mapping");
    const currency = body.currency === "IRT" ? "IRT" : "IRR";
    const parsedRows = draft.parsed_rows.slice(0, MAX_IMPORT_ROWS);
    const now = new Date();

    if (draft.kind === "products") {
      const prepared = parsedRows.map((row, index) => {
        const name = cell(row, draft.headers, mapping, "name").trim();
        if (!name)
          throw new ApiError(400, `نام کالا در ردیف ${index + 2} خالی است.`, "row_missing_name");
        return [
          scope.branchId,
          scope.businessId,
          name.slice(0, 200),
          cell(row, draft.headers, mapping, "sku").trim().slice(0, 100),
          cell(row, draft.headers, mapping, "barcode").trim().slice(0, 100),
          cell(row, draft.headers, mapping, "brand").trim().slice(0, 100),
          cell(row, draft.headers, mapping, "model").trim().slice(0, 100),
          cell(row, draft.headers, mapping, "unit").trim().slice(0, 50),
          optionalPrice(cell(row, draft.headers, mapping, "costPrice"), currency),
          optionalPrice(cell(row, draft.headers, mapping, "salePrice"), currency),
        ];
      });
      const seenSku = new Set<string>();
      const seenBarcode = new Set<string>();
      for (const row of prepared) {
        const sku = normalizeText(String(row[3]));
        const barcode = normalizeText(String(row[4]));
        if ((sku && seenSku.has(sku)) || (barcode && seenBarcode.has(barcode)))
          throw new ApiError(
            409,
            "در فایل، کد کالا یا بارکد تکراری وجود دارد. فایل را اصلاح کنید.",
            "duplicate_in_file",
          );
        if (sku) seenSku.add(sku);
        if (barcode) seenBarcode.add(barcode);
      }
      const result = await transaction(async (client) => {
        const claimed = await client.query(
          `DELETE FROM import_drafts WHERE id = $1 AND user_id = $2 AND branch_id = $3 AND business_id = $4 AND expires_at > now() RETURNING id`,
          [draft.id, scope.id, scope.branchId, scope.businessId],
        );
        if (!claimed.rowCount)
          throw new ApiError(
            409,
            "این پیش‌نمایش قبلاً ثبت شده است. فایل را دوباره انتخاب کنید.",
            "draft_consumed",
          );
        const insert = valuesSql(prepared);
        await client.query(
          `INSERT INTO products(branch_id,business_id,name,sku,barcode,brand,model,unit,cost_price_rial,sale_price_rial) VALUES ${insert.sql}`,
          insert.values,
        );
        await recordAudit(client, {
          businessId: scope.businessId,
          branchId: scope.branchId,
          actorId: scope.id,
          eventType: "products.imported",
          entityType: "product_import",
          details: { count: prepared.length, fileName: draft.file_name },
        });
        return prepared.length;
      }).catch((error: { code?: string }) => {
        if (error.code === "23505")
          throw new ApiError(
            409,
            "یک کد کالا یا بارکد با کالای ثبت‌شده در این شعبه تکراری است.",
            "duplicate_product",
          );
        throw error;
      });
      return json({ imported: result, kind: "products" }, 201);
    }

    if (typeof body.supplierId !== "string")
      throw new ApiError(400, "تأمین‌کنندهٔ قیمت‌نامه را انتخاب کنید.", "missing_supplier");
    const sourceDate =
      typeof body.sourceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.sourceDate)
        ? body.sourceDate
        : now.toISOString().slice(0, 10);
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 200)
        : draft.file_name;
    const productsResult = await query<ProductCandidate>(
      `SELECT id, name, sku, barcode, brand, model, unit, cost_price_rial::text AS cost_price_rial,
        sale_price_rial::text AS sale_price_rial, version
       FROM products WHERE branch_id = $1 AND business_id = $2 AND archived_at IS NULL AND is_active
       ORDER BY created_at DESC LIMIT 10000`,
      [scope.branchId, scope.businessId],
    );
    const productById = new Map(productsResult.rows.map((product) => [product.id, product]));
    const duplicateKeys = new Map<string, number>();
    const keys = parsedRows.map((row) =>
      normalizeText(
        cell(row, draft.headers, mapping, "barcode") ||
          cell(row, draft.headers, mapping, "sku") ||
          cell(row, draft.headers, mapping, "name"),
      ),
    );
    for (const key of keys) duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
    const prepared = parsedRows.map((row, index) => {
      const name = cell(row, draft.headers, mapping, "name").trim().slice(0, 200);
      const sku = cell(row, draft.headers, mapping, "sku").trim().slice(0, 100);
      const barcode = cell(row, draft.headers, mapping, "barcode").trim().slice(0, 100);
      const brand = cell(row, draft.headers, mapping, "brand").trim().slice(0, 100);
      const model = cell(row, draft.headers, mapping, "model").trim().slice(0, 100);
      const unit = cell(row, draft.headers, mapping, "unit").trim().slice(0, 50);
      const rawPrice = cell(row, draft.headers, mapping, "price").trim();
      let price: string | null = null;
      try {
        price = parseMoneyToRial(rawPrice, currency).toString();
      } catch {
        price = null;
      }
      const matches = findMatches({ name, sku, barcode, brand, model }, productsResult.rows);
      const best = matches[0];
      const product = best ? productById.get(best.productId) : undefined;
      const warnings = reviewWarnings({
        name,
        unit,
        productUnit: product?.unit,
        price: price === null ? null : BigInt(price),
        previousPrice: product?.cost_price_rial ? BigInt(product.cost_price_rial) : null,
        duplicate: Boolean(keys[index] && (duplicateKeys.get(keys[index]) ?? 0) > 1),
        confidence: best?.confidence ?? 0,
      });
      if (
        matches.length > 1 &&
        matches[0].confidence - matches[1].confidence < 5 &&
        !warnings.includes("ambiguous_match")
      )
        warnings.push("ambiguous_match");
      return {
        sourceRow: index + 2,
        rawData: Object.fromEntries(
          draft.headers.map((header, column) => [header, row[column] ?? ""]),
        ),
        name,
        sku,
        barcode,
        brand,
        model,
        unit,
        price,
        previous: product?.cost_price_rial ?? null,
        version: product?.version ?? null,
        best,
        warnings,
        matches,
      };
    });
    const matchedCounts = new Map<string, number>();
    for (const item of prepared) {
      const productId = item.best?.productId;
      if (productId) matchedCounts.set(productId, (matchedCounts.get(productId) ?? 0) + 1);
    }
    for (const item of prepared) {
      if (
        item.best &&
        (matchedCounts.get(item.best.productId) ?? 0) > 1 &&
        !item.warnings.includes("duplicate_product_in_review")
      ) {
        item.warnings.push("duplicate_product_in_review");
      }
    }
    const date = new Date(`${sourceDate}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== sourceDate)
      throw new ApiError(400, "تاریخ قیمت‌نامه معتبر نیست.", "invalid_date");

    const imported = await transaction(async (client) => {
      const claimed = await client.query(
        `DELETE FROM import_drafts WHERE id = $1 AND user_id = $2 AND branch_id = $3 AND business_id = $4 AND expires_at > now() RETURNING id`,
        [draft.id, scope.id, scope.branchId, scope.businessId],
      );
      if (!claimed.rowCount)
        throw new ApiError(
          409,
          "این پیش‌نمایش قبلاً ثبت شده است. فایل را دوباره انتخاب کنید.",
          "draft_consumed",
        );
      const list = await client.query<{ id: string }>(
        `INSERT INTO price_lists(branch_id,business_id,supplier_id,title,source_file_name,source_hash,source_date,currency,row_count,status,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'in_review',$10) RETURNING id`,
        [
          scope.branchId,
          scope.businessId,
          body.supplierId,
          title,
          draft.file_name,
          draft.file_hash,
          sourceDate,
          currency,
          prepared.length,
          scope.id,
        ],
      );
      const priceListId = list.rows[0].id;
      const rowValues = prepared.map((item) => [
        priceListId,
        scope.branchId,
        scope.businessId,
        item.sourceRow,
        JSON.stringify(item.rawData),
        item.name,
        item.sku,
        item.barcode,
        item.brand,
        item.model,
        item.unit,
        item.price,
        item.previous,
        item.version,
        item.best?.productId ?? null,
        item.best?.method ?? "none",
        item.best?.confidence ?? 0,
        item.warnings,
      ]);
      const insertRows = valuesSql(rowValues);
      const createdRows = await client.query<{ id: string; source_row: number }>(
        `INSERT INTO price_list_rows(price_list_id,branch_id,business_id,source_row,raw_data,source_name,source_sku,source_barcode,source_brand,source_model,source_unit,price_rial,previous_price_rial,expected_product_version,matched_product_id,match_method,confidence,warning_codes)
         VALUES ${insertRows.sql} RETURNING id, source_row`,
        insertRows.values,
      );
      const rowIdBySource = new Map(createdRows.rows.map((row) => [row.source_row, row.id]));
      const suggestions: unknown[][] = [];
      for (const item of prepared) {
        for (const suggestion of item.matches as MatchCandidate[]) {
          suggestions.push([
            rowIdBySource.get(item.sourceRow),
            suggestion.productId,
            scope.branchId,
            scope.businessId,
            suggestion.confidence,
            suggestion.method,
          ]);
        }
      }
      if (suggestions.length) {
        const insertSuggestions = valuesSql(suggestions);
        await client.query(
          `INSERT INTO match_suggestions(row_id,product_id,branch_id,business_id,confidence,method) VALUES ${insertSuggestions.sql}`,
          insertSuggestions.values,
        );
      }
      await recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: "price_list.imported",
        entityType: "price_list",
        entityId: priceListId,
        details: {
          rowCount: prepared.length,
          fileName: draft.file_name,
          supplierId: body.supplierId,
        },
      });
      return { id: priceListId, rowCount: prepared.length };
    }).catch((error: { code?: string }) => {
      if (error.code === "23505")
        throw new ApiError(
          409,
          "این فایل قبلاً وارد شده یا یک شناسهٔ تکراری دارد.",
          "duplicate_import",
        );
      if (error.code === "23503")
        throw new ApiError(404, "تأمین‌کننده یا کالا در این شعبه پیدا نشد.", "foreign_scope");
      throw error;
    });
    return json({ ...imported, kind: "price_list" }, 201);
  } catch (error) {
    return fail(error);
  }
}
