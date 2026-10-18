import { ApiError, fail, json, readJson, requireBranch, requireSameOrigin } from "@/lib/api";
import {
  assertCategoryNameAvailable,
  lockCategoryBranch,
  parseCategoryDescription,
  parseCategoryName,
  parseParentCategoryId,
} from "@/lib/category-utils";
import { recordAudit } from "@/lib/audit";
import { query, transaction } from "@/lib/db";
import { normalizeText } from "@/lib/domain";
import { clampPage, parsePagination } from "@/lib/pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CategoryRow = {
  id: string;
  name: string;
  description: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  product_count: number;
  child_count: number;
};

type CategoryTreeRow = CategoryRow & { depth: number; is_path: boolean };

const categoryCollator = new Intl.Collator("fa", { numeric: true, sensitivity: "base" });

export async function GET(request: Request) {
  try {
    const scope = await requireBranch(request);
    const url = new URL(request.url);
    const pagination = parsePagination(url.searchParams, { defaultSize: 10 });
    const search = normalizeText(url.searchParams.get("q") ?? "").slice(0, 100);
    const type = url.searchParams.get("type") ?? "all";
    const products = url.searchParams.get("products") ?? "all";
    const sort = url.searchParams.get("sort") ?? "name";
    const order = url.searchParams.get("order") === "desc" ? "desc" : "asc";
    if (!["all", "root", "child"].includes(type))
      throw new ApiError(400, "فیلتر سطح دسته معتبر نیست.", "invalid_category_type");
    if (!["all", "has", "empty"].includes(products))
      throw new ApiError(400, "فیلتر تعداد کالا معتبر نیست.", "invalid_category_products");
    if (!["name", "products", "created"].includes(sort))
      throw new ApiError(400, "مرتب‌سازی دسته معتبر نیست.", "invalid_category_sort");
    const [categories, unassigned] = await Promise.all([
      query<CategoryRow>(
        `SELECT c.id, c.name, c.description, c.parent_id, c.created_at, c.updated_at,
           count(DISTINCT p.id)::int AS product_count, count(DISTINCT child.id)::int AS child_count
         FROM product_categories c
         LEFT JOIN products p ON p.category_id = c.id AND p.branch_id = c.branch_id AND p.archived_at IS NULL
         LEFT JOIN product_categories child ON child.parent_id = c.id AND child.branch_id = c.branch_id
         WHERE c.branch_id = $1 AND c.business_id = $2
         GROUP BY c.id ORDER BY c.created_at, lower(c.name)`,
        [scope.branchId, scope.businessId],
      ),
      query<{ count: number }>(
        "SELECT count(*)::int AS count FROM products WHERE branch_id = $1 AND business_id = $2 AND category_id IS NULL AND archived_at IS NULL",
        [scope.branchId, scope.businessId],
      ),
    ]);
    if (url.searchParams.get("all") === "true") {
      return json({
        rows: categories.rows,
        total: categories.rowCount,
        categoryTotal: categories.rowCount,
        page: 1,
        size: categories.rowCount,
        unassignedProductCount: unassigned.rows[0].count,
      });
    }
    const byId = new Map(categories.rows.map((category) => [category.id, category]));
    const matched = categories.rows.filter((category) => {
      if (type === "root" && category.parent_id !== null) return false;
      if (type === "child" && category.parent_id === null) return false;
      if (products === "has" && category.product_count === 0) return false;
      if (products === "empty" && category.product_count > 0) return false;
      return !search || normalizeText(`${category.name} ${category.description}`).includes(search);
    });
    const matchedIds = new Set(matched.map((category) => category.id));
    const visibleIds = new Set(matchedIds);
    for (const category of matched) {
      let parentId = category.parent_id;
      while (parentId && byId.has(parentId)) {
        visibleIds.add(parentId);
        parentId = byId.get(parentId)?.parent_id ?? null;
      }
    }
    const children = new Map<string, CategoryRow[]>();
    for (const category of categories.rows) {
      const key = category.parent_id ?? "__root__";
      const group = children.get(key) ?? [];
      group.push(category);
      children.set(key, group);
    }
    const compare = (left: CategoryRow, right: CategoryRow) => {
      let result = 0;
      if (sort === "products") result = left.product_count - right.product_count;
      else if (sort === "created")
        result = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      else result = categoryCollator.compare(left.name, right.name);
      if (result === 0) result = categoryCollator.compare(left.name, right.name);
      return order === "asc" ? result : -result;
    };
    const tree: { category: CategoryRow; depth: number }[] = [];
    const visit = (parentId: string | null, depth: number) => {
      const group = [...(children.get(parentId ?? "__root__") ?? [])].sort(compare);
      for (const category of group) {
        if (visibleIds.has(category.id)) {
          tree.push({ category, depth });
          visit(category.id, depth + 1);
        }
      }
    };
    visit(null, 0);
    const page = clampPage(pagination.page, pagination.size, tree.length);
    const pageEntries = tree.slice((page - 1) * pagination.size, page * pagination.size);
    const pageIds = new Set(pageEntries.map(({ category }) => category.id));
    const contextIds = new Set<string>();
    for (const { category } of pageEntries) {
      let parentId = category.parent_id;
      while (parentId && byId.has(parentId)) {
        if (!pageIds.has(parentId)) contextIds.add(parentId);
        parentId = byId.get(parentId)?.parent_id ?? null;
      }
    }
    const rows: CategoryTreeRow[] = tree
      .filter(({ category }) => pageIds.has(category.id) || contextIds.has(category.id))
      .map(({ category, depth }) => ({
        ...category,
        depth,
        is_path: !pageIds.has(category.id) || !matchedIds.has(category.id),
      }));
    return json({
      rows,
      total: tree.length,
      categoryTotal: categories.rowCount,
      page,
      size: pagination.size,
      unassignedProductCount: unassigned.rows[0].count,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const scope = await requireBranch(request);
    const body = await readJson<Record<string, unknown>>(request);
    const name = parseCategoryName(body.name);
    const description = parseCategoryDescription(body.description);
    const parentId = parseParentCategoryId(body.parentId ?? null);

    const category = await transaction(async (client) => {
      await lockCategoryBranch(client, scope.branchId, scope.businessId);
      if (parentId) {
        const parent = await client.query(
          "SELECT id FROM product_categories WHERE id = $1 AND branch_id = $2 AND business_id = $3 FOR UPDATE",
          [parentId, scope.branchId, scope.businessId],
        );
        if (!parent.rowCount)
          throw new ApiError(
            404,
            "دسته‌بندی والد در این شعبه پیدا نشد.",
            "category_parent_not_found",
          );
      }
      await assertCategoryNameAvailable(client, { branchId: scope.branchId, parentId, name });
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO product_categories(branch_id, business_id, name, description, parent_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [scope.branchId, scope.businessId, name, description, parentId],
      );
      await recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: "product_category.created",
        entityType: "product_category",
        entityId: inserted.rows[0].id,
        details: { name, parentId },
      });
      return inserted.rows[0];
    }).catch((error: { code?: string }) => {
      if (error.code === "23505")
        throw new ApiError(
          409,
          "دسته‌بندی هم‌نامی در همین سطح وجود دارد.",
          "duplicate_category_name",
        );
      throw error;
    });
    return json(category, 201);
  } catch (error) {
    return fail(error);
  }
}
