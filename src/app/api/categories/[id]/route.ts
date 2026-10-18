import { ApiError, fail, json, readJson, requireBranch, requireSameOrigin } from "@/lib/api";
import {
  assertCategoryNameAvailable,
  isUuid,
  lockCategoryBranch,
  parseCategoryDescription,
  parseCategoryName,
  parseParentCategoryId,
} from "@/lib/category-utils";
import { recordAudit } from "@/lib/audit";
import { query, transaction } from "@/lib/db";
import { clampPage, parsePagination } from "@/lib/pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const scope = await requireBranch(request);
    const { id } = await context.params;
    const pagination = parsePagination(new URL(request.url).searchParams, {
      defaultSize: 10,
    });
    if (!isUuid(id)) throw new ApiError(404, "دسته‌بندی پیدا نشد.", "category_not_found");
    const result = await query(
      `SELECT c.id, c.name, c.description, c.parent_id, parent.name AS parent_name,
         c.created_at, c.updated_at, c.version,
         (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.branch_id = c.branch_id AND p.archived_at IS NULL) AS product_count,
         (SELECT count(*)::int FROM product_categories child WHERE child.parent_id = c.id AND child.branch_id = c.branch_id) AS child_count
       FROM product_categories c
       LEFT JOIN product_categories parent ON parent.id = c.parent_id AND parent.branch_id = c.branch_id
       WHERE c.id = $1 AND c.branch_id = $2 AND c.business_id = $3`,
      [id, scope.branchId, scope.businessId],
    );
    if (!result.rowCount) throw new ApiError(404, "دسته‌بندی پیدا نشد.", "category_not_found");
    const childCount = await query<{ count: string }>(
      "SELECT count(*) FROM product_categories WHERE parent_id = $1 AND branch_id = $2 AND business_id = $3",
      [id, scope.branchId, scope.businessId],
    );
    const childrenTotal = Number(childCount.rows[0].count);
    const page = clampPage(pagination.page, pagination.size, childrenTotal);
    const children = await query(
        `SELECT c.id, c.name, c.description, c.parent_id, c.created_at, c.updated_at,
           (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.branch_id = c.branch_id AND p.archived_at IS NULL) AS product_count,
           (SELECT count(*)::int FROM product_categories child WHERE child.parent_id = c.id AND child.branch_id = c.branch_id) AS child_count
         FROM product_categories c
         WHERE c.parent_id = $1 AND c.branch_id = $2 AND c.business_id = $3
         ORDER BY lower(c.name), c.created_at LIMIT $4 OFFSET $5`,
        [id, scope.branchId, scope.businessId, pagination.size, (page - 1) * pagination.size],
      );
    return json({
      ...result.rows[0],
      children: children.rows,
      childrenTotal,
      childrenPage: page,
      childrenSize: pagination.size,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request);
    const scope = await requireBranch(request);
    const { id } = await context.params;
    if (!isUuid(id)) throw new ApiError(404, "دسته‌بندی پیدا نشد.", "category_not_found");
    const body = await readJson<Record<string, unknown>>(request);

    const category = await transaction(async (client) => {
      await lockCategoryBranch(client, scope.branchId, scope.businessId);
      const current = await client.query<{
        id: string;
        name: string;
        description: string;
        parent_id: string | null;
      }>(
        `SELECT id, name, description, parent_id FROM product_categories
         WHERE id = $1 AND branch_id = $2 AND business_id = $3 FOR UPDATE`,
        [id, scope.branchId, scope.businessId],
      );
      if (!current.rowCount) throw new ApiError(404, "دسته‌بندی پیدا نشد.", "category_not_found");
      const previous = current.rows[0];
      const name = Object.hasOwn(body, "name") ? parseCategoryName(body.name) : previous.name;
      const description = Object.hasOwn(body, "description")
        ? parseCategoryDescription(body.description)
        : previous.description;
      const parentId = Object.hasOwn(body, "parentId")
        ? parseParentCategoryId(body.parentId)
        : previous.parent_id;

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
        const cycle = await client.query(
          `WITH RECURSIVE descendants(id) AS (
             SELECT id FROM product_categories WHERE id = $1 AND branch_id = $2
             UNION ALL
             SELECT child.id FROM product_categories child
             JOIN descendants parent ON child.parent_id = parent.id
             WHERE child.branch_id = $2
           )
           SELECT 1 FROM descendants WHERE id = $3 LIMIT 1`,
          [id, scope.branchId, parentId],
        );
        if (cycle.rowCount)
          throw new ApiError(
            409,
            "یک دسته‌بندی نمی‌تواند زیرمجموعهٔ خودش یا زیرمجموعه‌هایش باشد.",
            "category_cycle",
          );
      }
      await assertCategoryNameAvailable(client, {
        branchId: scope.branchId,
        parentId,
        name,
        excludeId: id,
      });
      const updated = await client.query(
        `UPDATE product_categories
         SET name = $1, description = $2, parent_id = $3, version = version + 1, updated_at = now()
         WHERE id = $4 AND branch_id = $5 AND business_id = $6
         RETURNING id, name, description, parent_id, created_at, updated_at, version`,
        [name, description, parentId, id, scope.branchId, scope.businessId],
      );
      await recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: "product_category.updated",
        entityType: "product_category",
        entityId: id,
        details: {
          previousName: previous.name,
          name,
          previousParentId: previous.parent_id,
          parentId,
        },
      });
      return updated.rows[0];
    }).catch((error: { code?: string }) => {
      if (error.code === "23505")
        throw new ApiError(
          409,
          "دسته‌بندی هم‌نامی در همین سطح وجود دارد.",
          "duplicate_category_name",
        );
      throw error;
    });
    return json(category);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request);
    const scope = await requireBranch(request);
    const { id } = await context.params;
    if (!isUuid(id)) throw new ApiError(404, "دسته‌بندی پیدا نشد.", "category_not_found");

    const result = await transaction(async (client) => {
      await lockCategoryBranch(client, scope.branchId, scope.businessId);
      const category = await client.query<{ name: string }>(
        `SELECT name FROM product_categories WHERE id = $1 AND branch_id = $2 AND business_id = $3 FOR UPDATE`,
        [id, scope.branchId, scope.businessId],
      );
      if (!category.rowCount) throw new ApiError(404, "دسته‌بندی پیدا نشد.", "category_not_found");
      const children = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM product_categories WHERE parent_id = $1 AND branch_id = $2",
        [id, scope.branchId],
      );
      if (children.rows[0].count > 0)
        throw new ApiError(
          409,
          "این دسته‌بندی زیر‌دسته دارد؛ ابتدا زیر‌دسته‌ها را منتقل یا حذف کنید.",
          "category_has_children",
        );
      const unassigned = await client.query(
        `UPDATE products SET category_id = NULL, updated_at = now()
         WHERE category_id = $1 AND branch_id = $2 AND business_id = $3`,
        [id, scope.branchId, scope.businessId],
      );
      await client.query(
        "DELETE FROM product_categories WHERE id = $1 AND branch_id = $2 AND business_id = $3",
        [id, scope.branchId, scope.businessId],
      );
      await recordAudit(client, {
        businessId: scope.businessId,
        branchId: scope.branchId,
        actorId: scope.id,
        eventType: "product_category.deleted",
        entityType: "product_category",
        entityId: id,
        details: { name: category.rows[0].name, unassignedProducts: unassigned.rowCount },
      });
      return { id, unassignedProducts: unassigned.rowCount };
    });
    return json(result);
  } catch (error) {
    return fail(error);
  }
}
