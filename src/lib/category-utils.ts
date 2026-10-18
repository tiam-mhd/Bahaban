import type { PoolClient } from "pg";
import { ApiError } from "@/lib/api";
import { normalizeText } from "@/lib/domain";

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function parseCategoryName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 120)
    throw new ApiError(400, "نام دسته‌بندی باید بین ۱ تا ۱۲۰ نویسه باشد.", "invalid_category_name");
  return name;
}

export function parseCategoryDescription(value: unknown): string {
  const description = typeof value === "string" ? value.trim() : "";
  if (description.length > 1000)
    throw new ApiError(
      400,
      "توضیحات دسته‌بندی نباید بیشتر از ۱۰۰۰ نویسه باشد.",
      "invalid_category_description",
    );
  return description;
}

export function parseParentCategoryId(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (!isUuid(value))
    throw new ApiError(400, "دسته‌بندی والد معتبر نیست.", "invalid_category_parent");
  return value;
}

export async function lockCategoryBranch(
  client: PoolClient,
  branchId: string,
  businessId: string,
): Promise<void> {
  const branch = await client.query(
    "SELECT id FROM branches WHERE id = $1 AND business_id = $2 AND is_active = true FOR UPDATE",
    [branchId, businessId],
  );
  if (!branch.rowCount)
    throw new ApiError(409, "شعبهٔ فعال دیگر در دسترس نیست.", "branch_unavailable");
}

export async function assertCategoryNameAvailable(
  client: PoolClient,
  input: {
    branchId: string;
    parentId: string | null;
    name: string;
    excludeId?: string;
  },
): Promise<void> {
  const values: unknown[] = [input.branchId, input.parentId, input.excludeId ?? null];
  const candidates = await client.query<{ name: string }>(
    `SELECT name FROM product_categories
     WHERE branch_id = $1 AND parent_id IS NOT DISTINCT FROM $2::uuid
       AND ($3::uuid IS NULL OR id <> $3)`,
    values,
  );
  if (candidates.rows.some((row) => normalizeText(row.name) === normalizeText(input.name)))
    throw new ApiError(409, "دسته‌بندی هم‌نامی در همین سطح وجود دارد.", "duplicate_category_name");
}
