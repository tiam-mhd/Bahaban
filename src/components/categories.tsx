"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { api, dateFa, jsonBody, money } from "@/lib/client";
import { Icon, Modal, PaginationBar, Spinner } from "@/components/ui";
import type { Product, ProductCategory } from "@/components/types";
import type { Props } from "@/components/workspace";

type CategoryTreeItem = ProductCategory & { depth: number; is_path: boolean };
type CategoryDetail = ProductCategory & {
  parent_name: string | null;
  version: number;
  children: ProductCategory[];
  childrenTotal: number;
  childrenPage: number;
  childrenSize: number;
};
type CategoryProduct = Product & { category_id: string | null; category_name: string | null };
type CategoryListResponse = {
  rows: CategoryTreeItem[];
  total: number;
  categoryTotal: number;
  page: number;
  size: number;
  unassignedProductCount: number;
};
type CategoryOptionsResponse = Omit<CategoryListResponse, "rows"> & { rows: ProductCategory[] };
type ProductListResponse = { rows: CategoryProduct[]; total: number; page: number; size: number };
type CategoryDialog =
  | { mode: "create"; parentId: string | null }
  | { mode: "edit"; category: ProductCategory };

export function CategoriesSection({ onToast }: Pick<Props, "onToast">) {
  const idPrefix = useId();
  const [categories, setCategories] = useState<CategoryTreeItem[]>([]);
  const [categoryTotal, setCategoryTotal] = useState(0);
  const [categoryResultTotal, setCategoryResultTotal] = useState(0);
  const [categoryPage, setCategoryPage] = useState(1);
  const [categoryPageSize, setCategoryPageSize] = useState(10);
  const [formCategories, setFormCategories] = useState<ProductCategory[]>([]);
  const [unassignedProductCount, setUnassignedProductCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CategoryDetail | null>(null);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const [productError, setProductError] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryType, setCategoryType] = useState<"all" | "root" | "child">("all");
  const [categoryProducts, setCategoryProducts] = useState<"all" | "has" | "empty">("all");
  const [categorySort, setCategorySort] = useState<"name" | "products" | "created">("name");
  const [categoryOrder, setCategoryOrder] = useState<"asc" | "desc">("asc");
  const [productSearch, setProductSearch] = useState("");
  const [productStatus, setProductStatus] = useState<"all" | "active" | "inactive">("all");
  const [productSort, setProductSort] = useState<"name" | "sku" | "created" | "cost">("name");
  const [productOrder, setProductOrder] = useState<"asc" | "desc">("asc");
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(25);
  const [products, setProducts] = useState<CategoryProduct[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [childPage, setChildPage] = useState(1);
  const [childPageSize, setChildPageSize] = useState(10);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const productRequestId = useRef(0);
  const categoryRequestId = useRef(0);
  const [dialog, setDialog] = useState<CategoryDialog | null>(null);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadCategories = useCallback(
    async (
      preferId?: string,
      requestedPage = categoryPage,
      filters = {
        q: categorySearch,
        type: categoryType,
        products: categoryProducts,
        sort: categorySort,
        order: categoryOrder,
      },
    ) => {
    const requestId = ++categoryRequestId.current;
    setLoadingCategories(true);
    setCategoryError("");
    try {
      const params = new URLSearchParams({
        page: String(requestedPage),
        size: String(categoryPageSize),
        q: filters.q,
        type: filters.type,
        products: filters.products,
        sort: filters.sort,
        order: filters.order,
      });
      const result = await api<CategoryListResponse>(`/api/categories?${params.toString()}`);
      if (requestId === categoryRequestId.current) {
        setCategories(result.rows);
        setCategoryTotal(result.categoryTotal);
        setCategoryResultTotal(result.total);
        setUnassignedProductCount(result.unassignedProductCount);
        setSelectedId((current) => preferId ?? current ?? result.rows.find((row) => !row.is_path)?.id ?? null);
      }
    } catch (problem) {
      if (requestId === categoryRequestId.current)
        setCategoryError(problem instanceof Error ? problem.message : "دسته‌بندی‌ها بارگذاری نشدند.");
    } finally {
      if (requestId === categoryRequestId.current) setLoadingCategories(false);
    }
    },
    [categoryPage, categoryPageSize, categorySearch, categoryType, categoryProducts, categorySort, categoryOrder],
  );

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setLoadingDetail(false);
      return;
    }
    let current = true;
    setLoadingDetail(true);
    setCategoryError("");
    const params = new URLSearchParams({ page: String(childPage), size: String(childPageSize) });
    api<CategoryDetail>(`/api/categories/${encodeURIComponent(selectedId)}?${params.toString()}`)
      .then((result) => {
        if (current) setDetail(result);
      })
      .catch((problem) => {
        if (current) {
          setDetail(null);
          setCategoryError(
            problem instanceof Error ? problem.message : "جزئیات دسته بارگذاری نشد.",
          );
        }
      })
      .finally(() => {
        if (current) setLoadingDetail(false);
      });
    return () => {
      current = false;
    };
  }, [selectedId, childPage, childPageSize]);

  const loadProducts = useCallback(
    async (page = productPage, signal?: AbortSignal) => {
      const requestId = ++productRequestId.current;
      if (!selectedId) {
        setProducts([]);
        setProductTotal(0);
        setLoadingProducts(false);
        setProductError("");
        return;
      }
      setProducts([]);
      setProductTotal(0);
      setLoadingProducts(true);
      setProductError("");
      try {
        if (productSearch) await new Promise((resolve) => window.setTimeout(resolve, 220));
        if (signal?.aborted) return;
        const params = new URLSearchParams({
          q: productSearch,
          status: productStatus,
          sort: productSort,
          order: productOrder,
          page: String(page),
          size: String(productPageSize),
        });
        const result = await api<ProductListResponse>(
          `/api/categories/${encodeURIComponent(selectedId)}/products?${params.toString()}`,
          { signal },
        );
        if (requestId === productRequestId.current && !signal?.aborted) {
          setProducts(result.rows);
          setProductTotal(result.total);
        }
      } catch (problem) {
        if (requestId === productRequestId.current && !signal?.aborted) {
          setProductError(
            problem instanceof Error ? problem.message : "فهرست کالاها بارگذاری نشد.",
          );
        }
      } finally {
        if (requestId === productRequestId.current && !signal?.aborted) {
          setLoadingProducts(false);
        }
      }
    },
    [selectedId, productSearch, productStatus, productSort, productOrder, productPage, productPageSize],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadProducts(undefined, controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadProducts]);

  const childCategories = detail?.children ?? [];

  async function refreshSelected(id = selectedId) {
    setCategorySearch("");
    setCategoryType("all");
    setCategoryProducts("all");
    setCategorySort("name");
    setCategoryOrder("asc");
    setCategoryPage(1);
    setProductPage(1);
    setChildPage(1);
    await loadCategories(id ?? undefined, 1, {
      q: "",
      type: "all",
      products: "all",
      sort: "name",
      order: "asc",
    });
    if (id) {
      try {
        const params = new URLSearchParams({ page: "1", size: String(childPageSize) });
        setDetail(
          await api<CategoryDetail>(`/api/categories/${encodeURIComponent(id)}?${params.toString()}`),
        );
      } catch {
        setDetail(null);
      }
    }
  }

  async function openCategoryDialog(next: CategoryDialog) {
    try {
      const result = await api<CategoryOptionsResponse>("/api/categories?all=true");
      setFormCategories(result.rows);
      setDialog(next);
    } catch (problem) {
      onToast(problem instanceof Error ? problem.message : "فهرست دسته‌ها بارگذاری نشد.", true);
    }
  }

  async function removeCategory() {
    if (!selectedId || !detail) return;
    setDeleteBusy(true);
    try {
      const result = await api<{ unassignedProducts: number }>(
        `/api/categories/${encodeURIComponent(selectedId)}`,
        { method: "DELETE" },
      );
      setDetail(null);
      setSelectedId(null);
      setProductPage(1);
      setDeleteConfirmOpen(false);
      await loadCategories();
      onToast(
        result.unassignedProducts
          ? `دسته حذف شد؛ ${new Intl.NumberFormat("fa-IR").format(result.unassignedProducts)} کالا بدون دسته باقی ماند.`
          : "دسته‌بندی حذف شد.",
      );
    } catch (problem) {
      onToast(problem instanceof Error ? problem.message : "حذف دسته‌بندی انجام نشد.", true);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function removeProduct(product: CategoryProduct) {
    if (!selectedId || !window.confirm(`«${product.name}» از این دسته خارج شود؟`)) return;
    try {
      await api(
        `/api/categories/${encodeURIComponent(selectedId)}/products?productId=${encodeURIComponent(product.id)}`,
        { method: "DELETE" },
      );
      if (productPage !== 1) setProductPage(1);
      else await loadProducts(1);
      await loadCategories(selectedId);
      const params = new URLSearchParams({ page: String(childPage), size: String(childPageSize) });
      setDetail(
        await api<CategoryDetail>(`/api/categories/${encodeURIComponent(selectedId)}?${params.toString()}`),
      );
      onToast("کالا از دسته خارج شد و بدون دسته باقی ماند.");
    } catch (problem) {
      onToast(
        problem instanceof Error ? problem.message : "خارج کردن کالا از دسته انجام نشد.",
        true,
      );
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h2>دسته‌بندی کالاها</h2>
          <p>ساختار دسته‌ها و کالاهای هر دسته را در شعبهٔ فعال مدیریت کنید.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => void openCategoryDialog({ mode: "create", parentId: null })}
          type="button"
        >
          <Icon name="plus" size={15} /> دستهٔ اصلی جدید
        </button>
      </div>

      <section className="category-summary" aria-label="خلاصه دسته‌بندی کالاها">
        <div>
          <span>دسته‌ها و زیر‌دسته‌ها</span>
          <strong>{new Intl.NumberFormat("fa-IR").format(categoryTotal)}</strong>
        </div>
        <div>
          <span>کالاهای بدون دسته</span>
          <strong>{new Intl.NumberFormat("fa-IR").format(unassignedProductCount)}</strong>
        </div>
        <div>
          <span>کالاهای دستهٔ انتخاب‌شده</span>
          <strong>{new Intl.NumberFormat("fa-IR").format(detail?.product_count ?? 0)}</strong>
        </div>
      </section>

      {categoryError && !categories.length ? (
        <div className="panel category-load-error" role="alert">
          <span>{categoryError}</span>
          <button
            className="btn btn-ghost btn-small"
            onClick={() => void loadCategories()}
            type="button"
          >
            تلاش دوباره
          </button>
        </div>
      ) : (
        <div className="category-management-layout">
          <section
            className="panel category-tree-panel"
            aria-labelledby={`${idPrefix}-category-tree-title`}
          >
            <div className="panel-header">
              <div>
                <h3 id={`${idPrefix}-category-tree-title`}>دسته‌ها و زیر‌دسته‌ها</h3>
                <p>برای دیدن جزئیات، یک دسته را انتخاب کنید.</p>
              </div>
              <span className="pill">
                {new Intl.NumberFormat("fa-IR").format(categoryTotal)}
              </span>
            </div>
            <div className="category-filter-panel">
              <label className="search-box">
                <Icon name="search" size={15} />
                <input
                  aria-label="جست‌وجوی دسته‌بندی"
                  placeholder="نام یا توضیحات دسته"
                  value={categorySearch}
                  onChange={(event) => {
                    setCategorySearch(event.target.value);
                    setCategoryPage(1);
                  }}
                />
              </label>
              <div className="category-filter-fields">
                <select
                  aria-label="فیلتر سطح دسته‌بندی"
                  className="filter-select"
                  value={categoryType}
                  onChange={(event) => {
                    setCategoryType(event.target.value as typeof categoryType);
                    setCategoryPage(1);
                  }}
                >
                  <option value="all">همهٔ سطح‌ها</option>
                  <option value="root">دسته‌های اصلی</option>
                  <option value="child">زیر‌دسته‌ها</option>
                </select>
                <select
                  aria-label="فیلتر دسته‌ها براساس تعداد کالا"
                  className="filter-select"
                  value={categoryProducts}
                  onChange={(event) => {
                    setCategoryProducts(event.target.value as typeof categoryProducts);
                    setCategoryPage(1);
                  }}
                >
                  <option value="all">همهٔ دسته‌ها</option>
                  <option value="has">دارای کالا</option>
                  <option value="empty">بدون کالا</option>
                </select>
                <select
                  aria-label="مرتب‌سازی دسته‌بندی‌ها"
                  className="filter-select"
                  value={categorySort}
                  onChange={(event) => {
                    setCategorySort(event.target.value as typeof categorySort);
                    setCategoryPage(1);
                  }}
                >
                  <option value="name">مرتب‌سازی: نام</option>
                  <option value="products">مرتب‌سازی: تعداد کالا</option>
                  <option value="created">مرتب‌سازی: تاریخ ثبت</option>
                </select>
                <button
                  className="btn btn-ghost btn-small category-order-button"
                  onClick={() => {
                    setCategoryOrder((current) => (current === "asc" ? "desc" : "asc"));
                    setCategoryPage(1);
                  }}
                  type="button"
                  aria-label={
                    categoryOrder === "asc" ? "صعودی؛ تغییر به نزولی" : "نزولی؛ تغییر به صعودی"
                  }
                >
                  <Icon name="down" size={14} /> {categoryOrder === "asc" ? "صعودی" : "نزولی"}
                </button>
              </div>
            </div>
            <div className="category-tree-list">
              {loadingCategories && !categories.length ? (
                <Spinner label="در حال بارگذاری دسته‌ها" />
              ) : categoryTotal === 0 ? (
                <div className="category-tree-empty">
                  <span className="category-empty-icon icon-slot">
                    <Icon name="categories" size={20} />
                  </span>
                  <strong>هنوز دسته‌ای ندارید</strong>
                  <span>دستهٔ اصلی بسازید و کالاها را در آن قرار دهید.</span>
                  <button
                    className="btn btn-primary btn-small"
                    onClick={() => void openCategoryDialog({ mode: "create", parentId: null })}
                    type="button"
                  >
                    <Icon name="plus" size={14} /> ساخت دسته
                  </button>
                </div>
              ) : categories.length ? (
                categories.map(({ depth, is_path: isPath, ...category }) => (
                  <button
                    className={`category-tree-item${selectedId === category.id ? " selected" : ""}${isPath ? " path-only" : ""}`}
                    key={category.id}
                    onClick={() => {
                      setProductPage(1);
                      setChildPage(1);
                      setSelectedId(category.id);
                    }}
                    style={{ paddingInlineStart: 12 + depth * 18 }}
                    type="button"
                    aria-current={selectedId === category.id ? "true" : undefined}
                  >
                    <span className="category-tree-icon icon-slot">
                      <Icon name="categories" size={16} />
                    </span>
                    <span className="category-tree-name">
                      <strong>{category.name}</strong>
                      <small>
                        {category.child_count
                          ? `${new Intl.NumberFormat("fa-IR").format(category.child_count)} زیر‌دسته`
                          : category.parent_id
                            ? "زیر‌دسته"
                            : "دستهٔ اصلی"}
                      </small>
                    </span>
                    <span className="category-count-pill">
                      {new Intl.NumberFormat("fa-IR").format(category.product_count)} کالا
                    </span>
                  </button>
                ))
              ) : (
                <div className="category-tree-empty compact">
                  <strong>نتیجه‌ای پیدا نشد</strong>
                  <span>جست‌وجو یا فیلترها را تغییر دهید.</span>
                </div>
              )}
            </div>
            <PaginationBar
              page={categoryPage}
              size={categoryPageSize}
              total={categoryResultTotal}
              onPageChange={setCategoryPage}
              onSizeChange={(nextSize) => {
                setCategoryPageSize(nextSize);
                setCategoryPage(1);
              }}
            />
          </section>

          <section className="panel category-detail-panel" aria-label="جزئیات دسته‌بندی انتخاب‌شده">
            {!selectedId ? (
              <div className="category-no-selection">
                <span className="category-empty-icon icon-slot">
                  <Icon name="categories" size={22} />
                </span>
                <h3>دسته‌ای را انتخاب کنید</h3>
                <p>جزئیات دسته، زیر‌دسته‌ها و کالاهای آن اینجا نمایش داده می‌شوند.</p>
              </div>
            ) : detail?.id === selectedId ? (
              <>
                <div className="category-detail-header">
                  <div className="category-detail-title-row">
                    <span className="category-detail-icon icon-slot">
                      <Icon name="categories" size={21} />
                    </span>
                    <div>
                      <span className="eyebrow">
                        {detail.parent_name ? `زیر‌دستهٔ ${detail.parent_name}` : "دستهٔ اصلی"}
                      </span>
                      <h3 id={`${idPrefix}-category-detail-title`}>{detail.name}</h3>
                    </div>
                  </div>
                  <div className="toolbar-group category-detail-actions">
                    <button
                      className="btn btn-ghost btn-small"
                      onClick={() =>
                        void openCategoryDialog({ mode: "create", parentId: detail.id })
                      }
                      type="button"
                    >
                      <Icon name="plus" size={14} /> زیر‌دسته
                    </button>
                    <button
                      className="btn btn-ghost btn-small"
                      onClick={() =>
                        void openCategoryDialog({ mode: "edit", category: detail })
                      }
                      type="button"
                    >
                      <Icon name="settings" size={14} /> ویرایش
                    </button>
                    <button
                      className="btn btn-danger btn-small"
                      onClick={() => setDeleteConfirmOpen(true)}
                      type="button"
                    >
                      <Icon name="close" size={14} /> حذف
                    </button>
                  </div>
                </div>
                {detail.description && <p className="category-description">{detail.description}</p>}
                <div className="category-detail-meta">
                  {detail.parent_name && (
                    <span>
                      مسیر والد: {detail.parent_name} ← {detail.name}
                    </span>
                  )}
                  <span>تاریخ ساخت: {dateFa(detail.created_at)}</span>
                  <span>{new Intl.NumberFormat("fa-IR").format(detail.child_count)} زیر‌دسته</span>
                </div>
                {detail.childrenTotal > 0 && (
                  <div className="category-child-section">
                    <div className="category-section-title">
                      <h4>زیر‌دسته‌ها</h4>
                      <span>{new Intl.NumberFormat("fa-IR").format(detail.childrenTotal)}</span>
                    </div>
                    <div className="category-child-list">
                      {childCategories.map((child) => (
                        <button
                          className="category-child-chip"
                          key={child.id}
                          onClick={() => {
                            setProductPage(1);
                            setChildPage(1);
                            setSelectedId(child.id);
                          }}
                          type="button"
                        >
                          <Icon name="categories" size={15} />
                          <span>{child.name}</span>
                          <small>
                            {new Intl.NumberFormat("fa-IR").format(child.product_count)} کالا
                          </small>
                        </button>
                      ))}
                    </div>
                    <PaginationBar
                      page={detail.childrenPage}
                      size={detail.childrenSize}
                      total={detail.childrenTotal}
                      onPageChange={setChildPage}
                      onSizeChange={(nextSize) => {
                        setChildPageSize(nextSize);
                        setChildPage(1);
                      }}
                    />
                  </div>
                )}
                <div className="category-products-section">
                  <div className="category-section-title category-products-heading">
                    <div>
                      <h4>کالاهای این دسته</h4>
                      <span>{new Intl.NumberFormat("fa-IR").format(productTotal)} کالا</span>
                    </div>
                    <button
                      className="btn btn-primary btn-small"
                      onClick={() => setAddProductOpen(true)}
                      type="button"
                    >
                      <Icon name="plus" size={14} /> افزودن کالا
                    </button>
                  </div>
                  <div className="category-product-filters">
                    <label className="search-box">
                      <Icon name="search" size={15} />
                      <input
                        aria-label="جست‌وجو در کالاهای این دسته"
                        placeholder="نام، کد، بارکد، برند"
                        value={productSearch}
                        onChange={(event) => {
                          setProductSearch(event.target.value);
                          setProductPage(1);
                        }}
                      />
                    </label>
                    <select
                      aria-label="فیلتر وضعیت کالا"
                      className="filter-select"
                      value={productStatus}
                      onChange={(event) => {
                        setProductStatus(event.target.value as typeof productStatus);
                        setProductPage(1);
                      }}
                    >
                      <option value="all">همهٔ وضعیت‌ها</option>
                      <option value="active">فعال</option>
                      <option value="inactive">غیرفعال</option>
                    </select>
                    <select
                      aria-label="مرتب‌سازی کالاهای این دسته"
                      className="filter-select"
                      value={productSort}
                      onChange={(event) => {
                        setProductSort(event.target.value as typeof productSort);
                        setProductPage(1);
                      }}
                    >
                      <option value="name">نام</option>
                      <option value="sku">کد کالا</option>
                      <option value="created">تاریخ ثبت</option>
                      <option value="cost">قیمت خرید</option>
                    </select>
                    <button
                      className="btn btn-ghost btn-small"
                      onClick={() => {
                        setProductOrder((current) => (current === "asc" ? "desc" : "asc"));
                        setProductPage(1);
                      }}
                      type="button"
                      aria-label={
                        productOrder === "asc" ? "صعودی؛ تغییر به نزولی" : "نزولی؛ تغییر به صعودی"
                      }
                    >
                      <Icon name="down" size={14} /> {productOrder === "asc" ? "صعودی" : "نزولی"}
                    </button>
                  </div>
                  <div className="table-wrap category-product-table-wrap">
                    {loadingProducts ? (
                      <Spinner label="در حال بارگذاری کالاها" />
                    ) : productError ? (
                      <div className="category-products-empty" role="alert">
                        <strong>فهرست کالاها بارگذاری نشد</strong>
                        <span>{productError}</span>
                        <button
                          className="btn btn-ghost btn-small"
                          onClick={() => void loadProducts()}
                          type="button"
                        >
                          تلاش دوباره
                        </button>
                      </div>
                    ) : products.length ? (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>کالا</th>
                            <th>کد / بارکد</th>
                            <th>واحد</th>
                            <th>قیمت خرید</th>
                            <th>وضعیت</th>
                            <th>عملیات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {products.map((product) => (
                            <tr key={product.id}>
                              <td>
                                <div className="category-product-name">
                                  <strong>{product.name}</strong>
                                  <span>
                                    {[product.brand, product.model].filter(Boolean).join(" · ") ||
                                      "بدون برند یا مدل"}
                                  </span>
                                </div>
                              </td>
                              <td>{product.sku || product.barcode || "—"}</td>
                              <td>{product.unit || "—"}</td>
                              <td>{money(product.cost_price_rial)} ریال</td>
                              <td>
                                <span
                                  className={`pill ${product.is_active ? "pill-success" : "pill-warn"}`}
                                >
                                  {product.is_active ? "فعال" : "غیرفعال"}
                                </span>
                              </td>
                              <td>
                                <button
                                  className="icon-button category-remove-product"
                                  onClick={() => void removeProduct(product)}
                                  type="button"
                                  aria-label={`خارج کردن ${product.name} از این دسته`}
                                  title="خارج کردن از دسته"
                                >
                                  <Icon name="close" size={15} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="category-products-empty">
                        <span className="category-empty-icon icon-slot">
                          <Icon name="box" size={19} />
                        </span>
                        <strong>
                          {productSearch ? "کالایی پیدا نشد" : "هنوز کالایی در این دسته نیست"}
                        </strong>
                        <span>
                          {productSearch
                            ? "عبارت جست‌وجو را تغییر دهید."
                            : "یک کالای موجود را انتخاب کنید یا کالای تازه بسازید."}
                        </span>
                      </div>
                    )}
                  </div>
                  <PaginationBar
                    page={productPage}
                    size={productPageSize}
                    total={productTotal}
                    onPageChange={setProductPage}
                    onSizeChange={(nextSize) => {
                      setProductPageSize(nextSize);
                      setProductPage(1);
                    }}
                  />
                </div>
              </>
            ) : loadingDetail ? (
              <div className="category-no-selection">
                <Spinner label="در حال بارگذاری جزئیات" />
              </div>
            ) : (
              <div className="category-no-selection" role="alert">
                <h3>جزئیات دسته در دسترس نیست</h3>
                <p>{categoryError || "دسته ممکن است حذف شده باشد. فهرست را تازه‌سازی کنید."}</p>
                <button
                  className="btn btn-ghost"
                  onClick={() => void loadCategories()}
                  type="button"
                >
                  تازه‌سازی
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {dialog && (
        <CategoryFormModal
          categories={formCategories}
          dialog={dialog}
          onClose={() => setDialog(null)}
          onSaved={async (id, message) => {
            setDialog(null);
            await refreshSelected(id);
            onToast(message);
          }}
        />
      )}
      {addProductOpen && selectedId && (
        <AddCategoryProductModal
          categoryId={selectedId}
          categoryName={detail?.id === selectedId ? detail.name : "این دسته"}
          onClose={() => setAddProductOpen(false)}
          onAdded={async (message) => {
            setAddProductOpen(false);
            if (productPage !== 1) setProductPage(1);
            else await loadProducts(1);
            await loadCategories(selectedId);
            try {
              const params = new URLSearchParams({
                page: String(childPage),
                size: String(childPageSize),
              });
              setDetail(
                await api<CategoryDetail>(
                  `/api/categories/${encodeURIComponent(selectedId)}?${params.toString()}`,
                ),
              );
            } catch {
              setDetail(null);
            }
            onToast(message);
          }}
        />
      )}
      {deleteConfirmOpen && detail && (
        <Modal
          title="حذف دسته‌بندی"
          subtitle="کالاها حذف نمی‌شوند و بدون دسته باقی می‌مانند."
          onClose={() => setDeleteConfirmOpen(false)}
        >
          <p className="category-delete-copy">
            دستهٔ «<strong>{detail.name}</strong>» حذف شود؟
            {detail.child_count > 0 && " ابتدا باید زیر‌دسته‌ها را منتقل یا حذف کنید."}
            {detail.product_count > 0 &&
              ` ${new Intl.NumberFormat("fa-IR").format(detail.product_count)} کالای این دسته بدون دسته می‌مانند.`}
          </p>
          <div className="modal-foot">
            <button
              className="btn btn-ghost"
              onClick={() => setDeleteConfirmOpen(false)}
              type="button"
            >
              انصراف
            </button>
            <button
              className="btn btn-danger"
              disabled={deleteBusy || detail.child_count > 0}
              onClick={() => void removeCategory()}
              type="button"
            >
              {deleteBusy ? (
                <>
                  <i className="spinner" /> در حال حذف
                </>
              ) : (
                "حذف دسته"
              )}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function CategoryFormModal({
  categories,
  dialog,
  onClose,
  onSaved,
}: {
  categories: ProductCategory[];
  dialog: CategoryDialog;
  onClose: () => void;
  onSaved: (id: string, message: string) => Promise<void>;
}) {
  const idPrefix = useId();
  const nameId = `${idPrefix}-category-name`;
  const parentIdInput = `${idPrefix}-category-parent`;
  const descriptionId = `${idPrefix}-category-description`;
  const editing = dialog.mode === "edit" ? dialog.category : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [parentId, setParentId] = useState(
    dialog.mode === "create" ? (dialog.parentId ?? "") : (editing?.parent_id ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const excluded = useMemo(
    () =>
      editing
        ? new Set([editing.id, ...collectDescendants(editing.id, categories)])
        : new Set<string>(),
    [editing, categories],
  );
  const addingSubcategory = dialog.mode === "create" && dialog.parentId !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { name, description, parentId: parentId || null };
      const result = editing
        ? await api<{ id: string }>(`/api/categories/${encodeURIComponent(editing.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await api<{ id: string }>("/api/categories", jsonBody(body));
      await onSaved(result.id, editing ? "دسته‌بندی ویرایش شد." : "دسته‌بندی ساخته شد.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "ذخیرهٔ دسته‌بندی انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? "ویرایش دسته‌بندی" : addingSubcategory ? "افزودن زیر‌دسته" : "دستهٔ اصلی جدید"}
      subtitle="نام و جایگاه دسته‌بندی را برای شعبهٔ فعال مشخص کنید."
      onClose={onClose}
    >
      <form className="form-grid" onSubmit={submit}>
        <div className="field full">
          <label htmlFor={nameId}>نام دسته‌بندی *</label>
          <input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
          />
        </div>
        <div className="field full">
          <label htmlFor={parentIdInput}>دستهٔ والد</label>
          <select
            id={parentIdInput}
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">بدون والد · دستهٔ اصلی</option>
            {categories
              .filter((category) => !excluded.has(category.id))
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryPath(category, categories)}
                </option>
              ))}
          </select>
          <span className="field-hint">زیر‌دسته‌ها نیز می‌توانند زیر‌دسته داشته باشند.</span>
        </div>
        <div className="field full">
          <label htmlFor={descriptionId}>توضیحات (اختیاری)</label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={1000}
            rows={3}
          />
        </div>
        {error && (
          <p className="field full error-text" role="alert">
            {error}
          </p>
        )}
        <div className="field full modal-foot">
          <button className="btn btn-ghost" onClick={onClose} type="button">
            انصراف
          </button>
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "در حال ذخیره…" : editing ? "ذخیرهٔ تغییرها" : "ساخت دسته‌بندی"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddCategoryProductModal({
  categoryId,
  categoryName,
  onClose,
  onAdded,
}: {
  categoryId: string;
  categoryName: string;
  onClose: () => void;
  onAdded: (message: string) => Promise<void>;
}) {
  const idPrefix = useId();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [availableProducts, setAvailableProducts] = useState<CategoryProduct[]>([]);
  const [availableTotal, setAvailableTotal] = useState(0);
  const [availablePage, setAvailablePage] = useState(1);
  const [availableSize, setAvailableSize] = useState(10);
  const [loadingAvailable, setLoadingAvailable] = useState(true);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    sku: "",
    barcode: "",
    brand: "",
    model: "",
    unit: "",
    costPrice: "",
    salePrice: "",
    currency: "IRR",
  });

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(
      () => {
        setLoadingAvailable(true);
        const params = new URLSearchParams({
          available: "true",
          q: search,
          sort: "created",
          order: "desc",
          page: String(availablePage),
          size: String(availableSize),
        });
        api<ProductListResponse>(
          `/api/categories/${encodeURIComponent(categoryId)}/products?${params.toString()}`,
        )
          .then((result) => {
            if (current) {
              setAvailableProducts(result.rows);
              setAvailableTotal(result.total);
            }
          })
          .catch((problem) => {
            if (current)
              setError(problem instanceof Error ? problem.message : "فهرست کالاها بارگذاری نشد.");
          })
          .finally(() => {
            if (current) setLoadingAvailable(false);
          });
      },
      search ? 220 : 0,
    );
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [categoryId, search, availablePage, availableSize]);

  async function assignProduct(product: CategoryProduct) {
    setBusyProductId(product.id);
    setError("");
    try {
      await api(
        `/api/categories/${encodeURIComponent(categoryId)}/products`,
        jsonBody({ productId: product.id }),
      );
      await onAdded(
        product.category_name
          ? `کالا از «${product.category_name}» به «${categoryName}» منتقل شد.`
          : `کالا به «${categoryName}» افزوده شد.`,
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "افزودن کالا به دسته انجام نشد.");
    } finally {
      setBusyProductId(null);
    }
  }

  async function createProduct(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/products", jsonBody({ ...form, categoryId }));
      await onAdded(`کالا ساخته و به «${categoryName}» افزوده شد.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "ثبت کالا انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  function setField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal
      title="افزودن کالا به دسته"
      subtitle={`کالا به دستهٔ «${categoryName}» افزوده می‌شود.`}
      onClose={onClose}
      width={760}
    >
      <div className="category-add-tabs" role="tablist" aria-label="روش افزودن کالا">
        <button
          className={mode === "existing" ? "active" : ""}
          onClick={() => setMode("existing")}
          type="button"
          role="tab"
          aria-selected={mode === "existing"}
        >
          انتخاب کالای موجود
        </button>
        <button
          className={mode === "new" ? "active" : ""}
          onClick={() => setMode("new")}
          type="button"
          role="tab"
          aria-selected={mode === "new"}
        >
          ساخت کالای جدید
        </button>
      </div>
      {mode === "existing" ? (
        <div className="category-available-products">
          <label className="search-box">
            <Icon name="search" size={15} />
            <input
              aria-label="جست‌وجوی کالای موجود"
              placeholder="نام، کد کالا یا بارکد"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setAvailablePage(1);
              }}
            />
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {loadingAvailable ? (
            <Spinner label="در حال جست‌وجوی کالاها" />
          ) : availableProducts.length ? (
            <div className="category-available-list">
              {availableProducts.map((product) => (
                <div className="category-available-row" key={product.id}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>
                      {[
                        product.sku && `کد ${product.sku}`,
                        product.barcode && `بارکد ${product.barcode}`,
                        product.unit,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "بدون کد و واحد"}
                    </span>
                    {product.category_name && (
                      <small>
                        دستهٔ فعلی: {product.category_name} · با انتخاب، کالا منتقل می‌شود.
                      </small>
                    )}
                  </div>
                  <button
                    className="btn btn-ghost btn-small"
                    disabled={busyProductId === product.id}
                    onClick={() => void assignProduct(product)}
                    type="button"
                  >
                    {busyProductId === product.id
                      ? "در حال افزودن…"
                      : product.category_name
                        ? "انتقال به این دسته"
                        : "افزودن"}
                  </button>
                </div>
              ))}
              <span className="field-hint">
                برای یافتن کالاهای بیشتر، نام یا کد کالا را جست‌وجو کنید.
              </span>
              <PaginationBar
                page={availablePage}
                size={availableSize}
                total={availableTotal}
                onPageChange={setAvailablePage}
                onSizeChange={(nextSize) => {
                  setAvailableSize(nextSize);
                  setAvailablePage(1);
                }}
              />
            </div>
          ) : (
            <div className="category-products-empty compact">
              <strong>{search ? "کالای منطبق پیدا نشد" : "کالای دیگری برای افزودن نیست"}</strong>
              <span>
                {search
                  ? "عبارت جست‌وجو را تغییر دهید یا کالای جدید بسازید."
                  : "می‌توانید از زبانهٔ ساخت کالا استفاده کنید."}
              </span>
            </div>
          )}
        </div>
      ) : (
        <form className="form-grid category-new-product-form" onSubmit={createProduct}>
          <div className="field full">
            <label htmlFor={`${idPrefix}-new-category-product-name`}>نام کالا *</label>
            <input
              id={`${idPrefix}-new-category-product-name`}
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
              maxLength={200}
              required
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-new-category-product-sku`}>کد کالا / SKU</label>
            <input
              id={`${idPrefix}-new-category-product-sku`}
              value={form.sku}
              onChange={(event) => setField("sku", event.target.value)}
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-new-category-product-barcode`}>بارکد</label>
            <input
              id={`${idPrefix}-new-category-product-barcode`}
              value={form.barcode}
              onChange={(event) => setField("barcode", event.target.value)}
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-new-category-product-brand`}>برند</label>
            <input
              id={`${idPrefix}-new-category-product-brand`}
              value={form.brand}
              onChange={(event) => setField("brand", event.target.value)}
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-new-category-product-model`}>مدل یا مشخصه</label>
            <input
              id={`${idPrefix}-new-category-product-model`}
              value={form.model}
              onChange={(event) => setField("model", event.target.value)}
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-new-category-product-unit`}>واحد</label>
            <input
              id={`${idPrefix}-new-category-product-unit`}
              value={form.unit}
              onChange={(event) => setField("unit", event.target.value)}
              maxLength={50}
              placeholder="عدد، بسته، کیلو…"
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-new-category-product-currency`}>واحد قیمت</label>
            <select
              id={`${idPrefix}-new-category-product-currency`}
              value={form.currency}
              onChange={(event) => setField("currency", event.target.value)}
            >
              <option value="IRR">ریال</option>
              <option value="IRT">تومان</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-new-category-product-cost`}>قیمت خرید فعلی</label>
            <input
              id={`${idPrefix}-new-category-product-cost`}
              inputMode="numeric"
              value={form.costPrice}
              onChange={(event) => setField("costPrice", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-new-category-product-sale`}>قیمت فروش (اختیاری)</label>
            <input
              id={`${idPrefix}-new-category-product-sale`}
              inputMode="numeric"
              value={form.salePrice}
              onChange={(event) => setField("salePrice", event.target.value)}
            />
          </div>
          {error && (
            <p className="field full error-text" role="alert">
              {error}
            </p>
          )}
          <div className="field full modal-foot">
            <button className="btn btn-ghost" onClick={onClose} type="button">
              انصراف
            </button>
            <button className="btn btn-primary" disabled={busy} type="submit">
              {busy ? "در حال ثبت…" : "ساخت کالا در این دسته"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function collectDescendants(id: string, categories: ProductCategory[]): string[] {
  const result: string[] = [];
  const queue = [id];
  while (queue.length) {
    const parentId = queue.shift();
    if (!parentId) continue;
    const children = categories.filter((category) => category.parent_id === parentId);
    for (const child of children) {
      result.push(child.id);
      queue.push(child.id);
    }
  }
  return result;
}

function categoryPath(category: ProductCategory, categories: ProductCategory[]): string {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const names = [category.name];
  let parentId = category.parent_id;
  let hops = 0;
  while (parentId && byId.has(parentId) && hops < 20) {
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parent_id;
    hops += 1;
  }
  return names.join(" / ");
}
