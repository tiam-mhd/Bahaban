export type Pagination = { page: number; size: number; offset: number };

export function parsePagination(
  params: URLSearchParams,
  options: { defaultSize?: number; maxSize?: number } = {},
): Pagination {
  const defaultSize = options.defaultSize ?? 25;
  const maxSize = options.maxSize ?? 100;
  const parse = (value: string | null, fallback: number) => {
    if (value === null || value.trim() === "") return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : fallback;
  };
  const page = Math.min(10_000, Math.max(1, parse(params.get("page"), 1)));
  const size = Math.min(maxSize, Math.max(1, parse(params.get("size"), defaultSize)));
  return { page, size, offset: (page - 1) * size };
}

export function clampPage(page: number, size: number, total: number): number {
  return Math.min(page, Math.max(1, Math.ceil(total / size)));
}
