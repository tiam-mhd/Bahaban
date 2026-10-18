"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { api, dateFa, jsonBody, money, moneyForCurrency } from "@/lib/client";
import {
  marginSuggestedPrice,
  markupSuggestedPrice,
  normalizeText,
  roundPrice,
} from "@/lib/domain";
import {
  importTemplates,
  type ImportMappingKey,
  type ImportTemplateKind,
} from "@/lib/import-templates";
import { Icon, Modal, PaginationBar, Spinner } from "@/components/ui";
import type {
  BranchSettings,
  HistoryEvent,
  PriceList,
  PriceListDetail,
  PriceRow,
  Product,
  Supplier,
} from "@/components/types";
import type { Props } from "@/components/workspace";

const fieldLabels: Record<string, string> = {
  name: "نام کالا",
  sku: "کد کالا",
  barcode: "بارکد",
  brand: "برند",
  model: "مدل / مشخصه",
  unit: "واحد",
  price: "قیمت خرید",
  costPrice: "قیمت خرید فعلی",
  salePrice: "قیمت فروش",
};

function ImportTemplateLinks({ kind }: { kind: ImportTemplateKind }) {
  const label = kind === "products" ? "کالاها" : "قیمت‌نامه";
  return (
    <div className="toolbar-group import-template-links" aria-label={`قالب ورود ${label}`}>
      <a
        className="btn btn-ghost btn-small"
        href={`/api/imports/template?kind=${kind}&format=xlsx`}
        download
      >
        <Icon name="download" size={14} /> قالب Excel
      </a>
      <a
        className="btn btn-ghost btn-small"
        href={`/api/imports/template?kind=${kind}&format=csv`}
        download
      >
        <Icon name="download" size={14} /> قالب CSV
      </a>
    </div>
  );
}

const warningLabels: Record<string, string> = {
  missing_name: "نام کالا خالی است",
  missing_unit: "واحد مشخص نیست",
  invalid_price: "قیمت قابل خواندن نیست",
  zero_price: "قیمت صفر است",
  duplicate_in_file: "ردیف تکراری در فایل",
  duplicate_product_in_review: "چند ردیف برای یک کالا",
  ambiguous_match: "تطبیق نیازمند بررسی است",
  large_price_change: "تغییر قیمت بیش از ۵۰٪ است",
  unmatched_product: "کالای متناظر پیدا نشد",
  unit_mismatch: "واحد کالا با فهرست شما تفاوت دارد",
};

function iranToday(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function ErrorMessage({ children }: { children: string }) {
  return (
    <p className="error-text" role="alert">
      {children}
    </p>
  );
}

function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div>
        <div className="empty-icon icon-slot">
          <Icon name={icon} size={22} />
        </div>
        <h3>{title}</h3>
        <p>{text}</p>
        {action}
      </div>
    </div>
  );
}

export function ProductsSection(props: Props) {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [total, setTotal] = useState(props.productTotal);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [modal, setModal] = useState<"create" | "import" | null>(null);

  useEffect(() => {
    let active = true;
    if (page === 1 && !appliedSearch) {
      setResults(props.products);
      setTotal(props.productTotal);
    }
    setBusy(true);
    const params = new URLSearchParams({ page: String(page), size: String(size), q: appliedSearch });
    api<{ rows: Product[]; total: number }>(`/api/products?${params.toString()}`)
      .then((data) => {
        if (active) {
          setResults(data.rows);
          setTotal(data.total);
        }
      })
      .catch((problem) => {
        if (active)
          props.onToast(problem instanceof Error ? problem.message : "بارگذاری کالاها انجام نشد.", true);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [page, size, appliedSearch, props.products, props.productTotal, props.onToast]);

  async function find(event?: FormEvent) {
    event?.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h2>فهرست کالاها</h2>
          <p>{new Intl.NumberFormat("fa-IR").format(total)} کالا در شعبهٔ انتخاب‌شده</p>
        </div>
        <div className="toolbar-group">
          <ImportTemplateLinks kind="products" />
          <button className="btn btn-ghost" onClick={() => setModal("import")} type="button">
            <Icon name="upload" size={15} /> ورود CSV یا Excel
          </button>
          <button className="btn btn-primary" onClick={() => setModal("create")} type="button">
            <Icon name="plus" size={15} /> افزودن کالا
          </button>
        </div>
      </div>
      <div className="toolbar">
        <form className="toolbar-group" onSubmit={find}>
          <label className="search-box">
            <Icon name="search" size={16} />
            <input
              aria-label="جست‌وجو در کالاها"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="نام، کد، بارکد یا برند"
            />
          </label>
          <button className="btn btn-ghost btn-small" type="submit">
            جست‌وجو
          </button>
        </form>
        <span className="pill">قیمت‌ها به ریال ثبت می‌شوند</span>
      </div>
      <div className="panel">
        {busy ? (
          <Spinner />
        ) : results.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>کالا</th>
                  <th>کد / بارکد</th>
                  <th>واحد</th>
                  <th>قیمت خرید فعلی</th>
                  <th>قیمت فروش</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {results.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <div className="product-name">
                        <span className="product-avatar icon-slot">{product.name.slice(0, 1)}</span>
                        <div className="product-copy">
                          <strong>{product.name}</strong>
                          <span>
                            {[product.brand, product.model].filter(Boolean).join(" · ") ||
                              "بدون برند یا مشخصه"}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div>{product.sku || "—"}</div>
                      <span className="fine-print">{product.barcode || "بدون بارکد"}</span>
                    </td>
                    <td>{product.unit || "—"}</td>
                    <td>
                      {money(product.cost_price_rial)} <span className="fine-print">ریال</span>
                    </td>
                    <td>
                      {money(product.sale_price_rial)} <span className="fine-print">ریال</span>
                    </td>
                    <td>
                      <span className={`pill ${product.is_active ? "pill-success" : ""}`}>
                        {product.is_active ? "فعال" : "غیرفعال"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={appliedSearch ? "search" : "box"}
            title={appliedSearch ? "کالایی پیدا نشد" : "هنوز کالایی ثبت نشده"}
            text={
              appliedSearch
                ? "عبارت جست‌وجو را تغییر دهید."
                : "فهرست کالاهای فعلی را از CSV یا Excel وارد کنید یا چند کالا را دستی بسازید."
            }
            action={
              <div className="toolbar-group" style={{ justifyContent: "center" }}>
                <button
                  className="btn btn-primary btn-small"
                  onClick={() => setModal("import")}
                  type="button"
                >
                  ورود فایل
                </button>
                <button
                  className="btn btn-ghost btn-small"
                  onClick={() => setModal("create")}
                  type="button"
                >
                  افزودن دستی
                </button>
              </div>
            }
          />
        )}
        <PaginationBar
          page={page}
          size={size}
          total={total}
          onPageChange={setPage}
          onSizeChange={(nextSize) => {
            setSize(nextSize);
            setPage(1);
          }}
        />
      </div>
      {modal === "create" && (
        <ProductModal
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await props.onRefresh();
            props.onToast("کالا ثبت شد.");
          }}
        />
      )}
      {modal === "import" && (
        <ImportModal
          kind="products"
          suppliers={props.suppliers}
          onClose={() => setModal(null)}
          onRefresh={props.onRefresh}
          onDone={async (result) => {
            setModal(null);
            await props.onRefresh();
            setPage(1);
            props.onToast(
              `${new Intl.NumberFormat("fa-IR").format(Number(result.imported))} کالا وارد شد.`,
            );
          }}
        />
      )}
    </>
  );
}

function ProductModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function field(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/products", jsonBody(form));
      await onSaved();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "ثبت کالا انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="افزودن کالا" subtitle="اطلاعات فقط در شعبهٔ فعال ذخیره می‌شود." onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <Field label="نام کالا" required full>
          <input
            value={form.name}
            onChange={(event) => field("name", event.target.value)}
            maxLength={200}
            required
          />
        </Field>
        <Field label="کد کالا / SKU">
          <input
            value={form.sku}
            onChange={(event) => field("sku", event.target.value)}
            maxLength={100}
          />
        </Field>
        <Field label="بارکد">
          <input
            value={form.barcode}
            onChange={(event) => field("barcode", event.target.value)}
            maxLength={100}
          />
        </Field>
        <Field label="برند">
          <input
            value={form.brand}
            onChange={(event) => field("brand", event.target.value)}
            maxLength={100}
          />
        </Field>
        <Field label="مدل یا مشخصه">
          <input
            value={form.model}
            onChange={(event) => field("model", event.target.value)}
            maxLength={100}
          />
        </Field>
        <Field label="واحد">
          <input
            value={form.unit}
            onChange={(event) => field("unit", event.target.value)}
            placeholder="عدد، بسته، کیلو…"
            maxLength={50}
          />
        </Field>
        <Field label="واحد قیمت">
          <select value={form.currency} onChange={(event) => field("currency", event.target.value)}>
            <option value="IRR">ریال</option>
            <option value="IRT">تومان</option>
          </select>
        </Field>
        <Field label="قیمت خرید فعلی">
          <input
            inputMode="numeric"
            value={form.costPrice}
            onChange={(event) => field("costPrice", event.target.value)}
          />
        </Field>
        <Field label="قیمت فروش (اختیاری)">
          <input
            inputMode="numeric"
            value={form.salePrice}
            onChange={(event) => field("salePrice", event.target.value)}
          />
        </Field>
        <div className="field full">
          <span className="field-hint">
            مبالغ در پایگاه داده به ریال صحیح تبدیل می‌شوند. قیمت فروش فقط ثبت اطلاعات است.
          </span>
        </div>
        {error && (
          <div className="field full">
            <ErrorMessage>{error}</ErrorMessage>
          </div>
        )}
        <div className="field full modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "در حال ثبت…" : "ثبت کالا"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({
  label,
  required,
  full,
  children,
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children;
  return (
    <div className={`field${full ? " full" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </label>
      {control}
    </div>
  );
}

export function SuppliersSection(props: Props) {
  const [modal, setModal] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [sort, setSort] = useState<"name" | "created">("name");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (page === 1 && !appliedSearch) {
      setSuppliers(props.suppliers);
      setTotal(props.supplierTotal);
    }
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
      q: appliedSearch,
      sort,
      order,
    });
    api<{ rows: Supplier[]; total: number }>(`/api/suppliers?${params.toString()}`)
      .then((data) => {
        if (active) {
          setSuppliers(data.rows);
          setTotal(data.total);
        }
      })
      .catch((problem) => {
        if (active)
          props.onToast(
            problem instanceof Error ? problem.message : "بارگذاری تأمین‌کنندگان انجام نشد.",
            true,
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, size, appliedSearch, sort, order, props.suppliers, props.supplierTotal, props.onToast]);

  return (
    <>
      <div className="page-heading">
        <div>
          <h2>تأمین‌کنندگان</h2>
          <p>
            {new Intl.NumberFormat("fa-IR").format(total)} تأمین‌کننده در همین شعبه
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal(true)} type="button">
          <Icon name="plus" size={15} /> ثبت تأمین‌کننده
        </button>
      </div>
      <div className="panel">
        <div className="toolbar supplier-toolbar">
          <form
            className="toolbar-group"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setAppliedSearch(search.trim());
            }}
          >
            <label className="search-box">
              <Icon name="search" size={15} />
              <input
                aria-label="جست‌وجو در تأمین‌کنندگان"
                placeholder="نام یا یادداشت"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button className="btn btn-ghost btn-small" type="submit">
              جست‌وجو
            </button>
          </form>
          <div className="toolbar-group">
            <select
              className="filter-select"
              aria-label="مرتب‌سازی تأمین‌کنندگان"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as typeof sort);
                setPage(1);
              }}
            >
              <option value="name">مرتب‌سازی: نام</option>
              <option value="created">مرتب‌سازی: تاریخ ثبت</option>
            </select>
            <button
              className="btn btn-ghost btn-small"
              type="button"
              onClick={() => {
                setOrder((current) => (current === "asc" ? "desc" : "asc"));
                setPage(1);
              }}
            >
              {order === "asc" ? "صعودی" : "نزولی"}
            </button>
          </div>
        </div>
        {loading ? (
          <Spinner label="در حال بارگذاری تأمین‌کنندگان" />
        ) : suppliers.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>نام تأمین‌کننده</th>
                  <th>یادداشت</th>
                  <th>تاریخ ثبت</th>
                  <th>دامنه</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <div className="product-name">
                        <span className="product-avatar icon-slot">
                          <Icon name="users" size={15} />
                        </span>
                        <strong>{supplier.name}</strong>
                      </div>
                    </td>
                    <td>{supplier.note || "—"}</td>
                    <td>{dateFa(supplier.created_at)}</td>
                    <td>
                      <span className="pill">شعبهٔ فعال</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : total > 0 ? (
          <Empty icon="search" title="تأمین‌کننده‌ای پیدا نشد" text="جست‌وجو را تغییر دهید." />
        ) : (
          <Empty
            icon="users"
            title="تأمین‌کننده‌ای ثبت نشده"
            text="برای ساخت اولین قیمت‌نامه، ابتدا نام تأمین‌کننده را در این شعبه ثبت کنید."
            action={
              <button
                className="btn btn-primary btn-small"
                onClick={() => setModal(true)}
                type="button"
              >
                ثبت تأمین‌کننده
              </button>
            }
          />
        )}
        <PaginationBar
          page={page}
          size={size}
          total={total}
          onPageChange={setPage}
          onSizeChange={(nextSize) => {
            setSize(nextSize);
            setPage(1);
          }}
        />
      </div>
      {modal && (
        <SupplierModal
          onClose={() => setModal(false)}
          onSaved={async () => {
            setModal(false);
            await props.onRefresh();
            props.onToast("تأمین‌کننده ثبت شد.");
          }}
        />
      )}
    </>
  );
}

function SupplierModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/suppliers", jsonBody({ name, note }));
      await onSaved();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "ثبت تأمین‌کننده انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="ثبت تأمین‌کننده"
      subtitle="تأمین‌کننده در این شعبه یک رکورد مستقل دارد."
      onClose={onClose}
    >
      <form onSubmit={submit} className="form-grid">
        <Field label="نام تأمین‌کننده" full required>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={160}
            required
          />
        </Field>
        <Field label="یادداشت اختیاری" full>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            placeholder="اطلاعاتی که برای پیگیری نیاز دارید"
          />
        </Field>
        {error && (
          <div className="field full">
            <ErrorMessage>{error}</ErrorMessage>
          </div>
        )}
        <div className="field full modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "در حال ثبت…" : "ثبت تأمین‌کننده"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ImportsSection(props: Props) {
  const [modal, setModal] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>ورود قیمت‌نامه</h2>
          <p>فایل CSV یا XLSX را بارگذاری و ستون‌های آن را مشخص کنید.</p>
        </div>
        <div className="toolbar-group">
          <ImportTemplateLinks kind="price_list" />
          <button className="btn btn-primary" onClick={() => setModal(true)} type="button">
            <Icon name="upload" size={15} /> بارگذاری قیمت‌نامه
          </button>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-body" style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <span className="stat-icon icon-slot">
            <Icon name="shield" />
          </span>
          <div>
            <strong style={{ fontSize: 12 }}>قیمت جاری تا تأیید شما دست‌نخورده می‌ماند</strong>
            <p className="fine-print" style={{ margin: "4px 0 0" }}>
              بعد از نگاشت ستون‌ها، ردیف‌ها و هشدارهای تطبیق در بخش «بازبینی تغییرها» نمایش داده
              می‌شوند. فایل اصلی ذخیره نمی‌شود؛ ردیف‌های استخراج‌شده برای بررسی نگه داشته می‌شوند.
            </p>
          </div>
        </div>
      </div>
      <PriceListTable
        lists={props.priceLists}
        totalCount={props.priceListTotal}
        onReview={(id) => {
          props.onSelectPriceList(id);
          props.onSection("review");
        }}
        onToast={props.onToast}
        onRefresh={props.onRefresh}
      />
      {modal && (
        <ImportModal
          kind="price_list"
          suppliers={props.suppliers}
          onClose={() => setModal(false)}
          onRefresh={props.onRefresh}
          onDone={async (result) => {
            setModal(false);
            await props.onRefresh();
            if (typeof result.id === "string") {
              props.onSelectPriceList(result.id);
              props.onSection("review");
            }
            props.onToast("قیمت‌نامه وارد شد؛ ردیف‌ها را بازبینی کنید.");
          }}
        />
      )}
    </>
  );
}

type Preview = {
  draftId: string;
  fileName: string;
  headers: string[];
  samples: string[][];
  rowCount: number;
};
type ImportKind = "products" | "price_list";
type MappingKey = ImportMappingKey;
type Mapping = Partial<Record<MappingKey, string>>;

const mappingKeys: MappingKey[] = [
  "name",
  "sku",
  "barcode",
  "brand",
  "model",
  "unit",
  "price",
  "costPrice",
  "salePrice",
];

function guessMapping(headers: string[], kind: ImportKind): Mapping {
  const aliases: Record<MappingKey, string[]> = {
    name: ["نام کالا", "نام محصول", "شرح کالا", "شرح", "عنوان", "product name", "item name", "نام"],
    sku: ["sku", "کد کالا", "کد محصول", "کد", "شناسه کالا", "product code"],
    barcode: ["بارکد", "barcode", "ean", "upc"],
    brand: ["برند", "brand"],
    model: ["مدل", "مشخصه", "model"],
    unit: ["واحد", "unit", "واحد سنجش"],
    price: ["قیمت خرید", "قیمت", "مبلغ", "فی", "price", "unit price"],
    costPrice: ["قیمت خرید فعلی", "بهای خرید", "cost price", "purchase price"],
    salePrice: ["قیمت فروش", "sale price", "selling price"],
  };
  const result: Mapping = {};
  for (const column of importTemplates[kind].columns) {
    const found = headers.find((header) => normalizeText(header) === normalizeText(column.header));
    if (found) result[column.key] = found;
  }
  for (const key of mappingKeys) {
    if (result[key]) continue;
    if (kind === "price_list" && (key === "costPrice" || key === "salePrice")) continue;
    if (kind === "products" && key === "price") continue;
    const candidates = aliases[key].map(normalizeText);
    const found =
      headers.find((header) => candidates.includes(normalizeText(header))) ??
      headers.find((header) =>
        candidates.some(
          (candidate) =>
            normalizeText(header).includes(candidate) || candidate.includes(normalizeText(header)),
        ),
      );
    if (found) result[key] = found;
  }
  return result;
}

function ImportModal({
  kind,
  suppliers,
  onClose,
  onRefresh,
  onDone,
}: {
  kind: ImportKind;
  suppliers: Supplier[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onDone: (result: Record<string, unknown>) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [currency, setCurrency] = useState<"IRR" | "IRT">("IRR");
  const [supplierId, setSupplierId] = useState("");
  const [supplierOptions, setSupplierOptions] = useState(suppliers);
  const [supplierTotal, setSupplierTotal] = useState(suppliers.length);
  const [supplierPage, setSupplierPage] = useState(1);
  const [supplierSize, setSupplierSize] = useState(10);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [title, setTitle] = useState("");
  const [sourceDate, setSourceDate] = useState(iranToday);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = kind === "products" ? "ورود فهرست کالاها" : "ورود قیمت‌نامهٔ تأمین‌کننده";

  useEffect(() => {
    if (kind !== "price_list") return;
    let active = true;
    const params = new URLSearchParams({
      page: String(supplierPage),
      size: String(supplierSize),
      q: supplierSearch,
      sort: "name",
      order: "asc",
    });
    api<{ rows: Supplier[]; total: number }>(`/api/suppliers?${params.toString()}`)
      .then((data) => {
        if (active) {
          setSupplierOptions(data.rows);
          setSupplierTotal(data.total);
        }
      })
      .catch((problem) => {
        if (active)
          setError(problem instanceof Error ? problem.message : "فهرست تأمین‌کنندگان بارگذاری نشد.");
      });
    return () => {
      active = false;
    };
  }, [kind, supplierPage, supplierSize, supplierSearch]);

  async function upload() {
    if (!file) {
      setError("یک فایل CSV یا XLSX انتخاب کنید.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", file);
      const result = await api<Preview>("/api/imports/preview", { method: "POST", body });
      setPreview(result);
      setTitle(result.fileName);
      setMapping(guessMapping(result.headers, kind));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "پیش‌نمایش فایل انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function addSupplier() {
    if (newSupplierName.trim().length < 2) {
      setError("نام تأمین‌کننده را وارد کنید.");
      return;
    }
    setCreatingSupplier(true);
    setError("");
    try {
      const result = await api<{ id: string }>(
        "/api/suppliers",
        jsonBody({ name: newSupplierName.trim() }),
      );
      setSupplierId(result.id);
      const createdSupplier = {
        id: result.id,
        name: newSupplierName.trim(),
        note: "",
        created_at: new Date().toISOString(),
      };
      setSelectedSupplier(createdSupplier);
      setSupplierOptions((current) =>
        current.some((supplier) => supplier.id === result.id)
          ? current
          : [...current, createdSupplier].sort((left, right) => left.name.localeCompare(right.name, "fa")),
      );
      setSupplierTotal((current) => current + 1);
      setSupplierSearch("");
      setSupplierPage(1);
      setNewSupplierName("");
      await onRefresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "ثبت تأمین‌کننده انجام نشد.");
    } finally {
      setCreatingSupplier(false);
    }
  }

  async function commit() {
    if (!preview) return;
    if (kind === "price_list" && !supplierId) {
      setError("تأمین‌کنندهٔ این قیمت‌نامه را انتخاب کنید.");
      return;
    }
    if (!mapping.name) {
      setError("ستون نام کالا را مشخص کنید.");
      return;
    }
    if (kind === "price_list" && !mapping.price) {
      setError("ستون قیمت را مشخص کنید.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<Record<string, unknown>>(
        "/api/imports/commit",
        jsonBody({
          draftId: preview.draftId,
          mapping,
          currency,
          supplierId,
          title,
          sourceDate,
        }),
      );
      await onDone(result);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "پردازش فایل انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  function selectMapping(key: MappingKey, value: string) {
    setMapping((current) => ({ ...current, [key]: value }));
  }
  const visibleKeys = mappingKeys.filter((key) =>
    kind === "products" ? key !== "price" : !["costPrice", "salePrice"].includes(key),
  );
  const sampleRows = (() => {
    const occurrences = new Map<string, number>();
    return (preview?.samples ?? []).slice(0, 5).map((row) => {
      const signature = JSON.stringify(row);
      const occurrence = occurrences.get(signature) ?? 0;
      occurrences.set(signature, occurrence + 1);
      return { row, key: `${signature}:${occurrence}` };
    });
  })();

  return (
    <Modal
      title={label}
      subtitle="فایل تا زمان نگاشت و پردازش در پیش‌نمایش موقت می‌ماند."
      onClose={onClose}
      width={kind === "products" ? 760 : 860}
    >
      <div className="form-grid">
        {kind === "price_list" && (
          <>
            <Field label="تأمین‌کننده" full required>
              <div className="supplier-chooser">
                <label className="search-box">
                  <Icon name="search" size={15} />
                  <input
                    aria-label="جست‌وجوی تأمین‌کننده"
                    placeholder="نام تأمین‌کننده را جست‌وجو کنید"
                    value={supplierSearch}
                    onChange={(event) => {
                      setSupplierSearch(event.target.value);
                      setSupplierPage(1);
                    }}
                  />
                </label>
                <select
                  value={supplierId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setSupplierId(nextId);
                    setSelectedSupplier(supplierOptions.find((item) => item.id === nextId) ?? null);
                  }}
                >
                  <option value="">انتخاب تأمین‌کننده</option>
                  {selectedSupplier && !supplierOptions.some((item) => item.id === selectedSupplier.id) && (
                    <option value={selectedSupplier.id}>{selectedSupplier.name}</option>
                  )}
                  {supplierOptions.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                <PaginationBar
                  page={supplierPage}
                  size={supplierSize}
                  total={supplierTotal}
                  onPageChange={setSupplierPage}
                  onSizeChange={(nextSize) => {
                    setSupplierSize(nextSize);
                    setSupplierPage(1);
                  }}
                />
              </div>
            </Field>
            {supplierTotal === 0 && (
              <div className="field full">
                <span className="field-hint">
                  {supplierSearch
                    ? "تأمین‌کننده‌ای با این عبارت پیدا نشد؛ نام را بررسی کنید یا تأمین‌کنندهٔ جدید را ثبت کنید."
                    : "هنوز تأمین‌کننده‌ای در این شعبه ثبت نشده است. از همین‌جا نام او را اضافه کنید."}
                </span>
              </div>
            )}
            <Field label="افزودن تأمین‌کنندهٔ جدید">
              <input
                value={newSupplierName}
                onChange={(event) => setNewSupplierName(event.target.value)}
                placeholder="نام تأمین‌کننده"
                maxLength={160}
              />
            </Field>
            <div className="field" style={{ alignContent: "end" }}>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={addSupplier}
                disabled={creatingSupplier}
              >
                {creatingSupplier ? "در حال ثبت…" : "ثبت تأمین‌کننده"}
              </button>
            </div>
            <Field label="عنوان قیمت‌نامه">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                placeholder="عنوان اختیاری"
              />
            </Field>
            <Field label="تاریخ قیمت‌نامه">
              <input
                type="date"
                dir="ltr"
                value={sourceDate}
                onChange={(event) => setSourceDate(event.target.value)}
              />
            </Field>
          </>
        )}
        <Field label="واحد پول فایل">
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as "IRR" | "IRT")}
          >
            <option value="IRR">ریال</option>
            <option value="IRT">تومان</option>
          </select>
        </Field>
        {!preview && (
          <>
            <div className="field full import-template-callout">
              <div className="import-template-copy">
                <strong>برای ورود بدون خطا از قالب آماده استفاده کنید</strong>
                <span className="field-hint">
                  سرستون‌ها را تغییر ندهید و داده‌ها را از ردیف دوم وارد کنید؛ فایل خالی فقط برای
                  دریافت قالب است.
                </span>
              </div>
              <ImportTemplateLinks kind={kind} />
            </div>
            <Field label="فایل قیمت‌نامه یا کالا" full>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <span className="field-hint">
                CSV با UTF-8 یا XLSX · حجم و تعداد ردیف‌ها در سمت سامانه بررسی می‌شود
              </span>
            </Field>
          </>
        )}
        {preview && (
          <div className="field full">
            <div className="pill pill-success">
              <Icon name="check" size={13} />
              {preview.fileName} · {new Intl.NumberFormat("fa-IR").format(preview.rowCount)} ردیف
            </div>
            <div className="form-grid" style={{ marginTop: 12 }}>
              {visibleKeys.map((key) => (
                <Field
                  key={key}
                  label={fieldLabels[key]}
                  required={key === "name" || (kind === "price_list" && key === "price")}
                >
                  <select
                    value={mapping[key] ?? ""}
                    onChange={(event) => selectMapping(key, event.target.value)}
                  >
                    <option value="">نگاشت نشده</option>
                    {preview.headers.map((header, column) => (
                      <option key={header} value={header}>
                        {header || `ستون ${column + 1}`}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
            <div className="mapping-preview">
              <table>
                <thead>
                  <tr>
                    {preview.headers.map((header, column) => (
                      <th key={header}>{header || `ستون ${column + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map(({ row, key }) => (
                    <tr key={key}>
                      {preview.headers.map((header, column) => (
                        <td key={header}>{row[column] || "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span className="field-hint">
              این فقط نمونهٔ پیش‌نمایش است. پس از پردازش، همهٔ ردیف‌ها و هشدارها در جدول بازبینی دیده
              می‌شوند.
            </span>
          </div>
        )}
        {error && (
          <div className="field full">
            <ErrorMessage>{error}</ErrorMessage>
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          انصراف
        </button>
        {!preview ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={upload}
            disabled={busy || !file}
          >
            {busy ? (
              <>
                <i className="spinner" /> در حال بررسی فایل
              </>
            ) : (
              <>
                پیش‌نمایش فایل <Icon name="chevron" size={14} />
              </>
            )}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setPreview(null);
                setError("");
              }}
            >
              انتخاب فایل دیگر
            </button>
            <button type="button" className="btn btn-primary" onClick={commit} disabled={busy}>
              {busy ? (
                <>
                  <i className="spinner" /> در حال پردازش
                </>
              ) : (
                "پردازش و ساخت قیمت‌نامه"
              )}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

async function downloadExport(id: string, format: "csv" | "xlsx", onToast: Props["onToast"]) {
  try {
    const response = await fetch(
      `/api/pricelists/${encodeURIComponent(id)}/export?format=${format}`,
      { credentials: "same-origin", cache: "no-store" },
    );
    if (!response.ok) {
      let message = "دریافت خروجی انجام نشد.";
      try {
        const body = (await response.json()) as { error?: string };
        message = body.error ?? message;
      } catch {
        /* no response details */
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bahaban-${id}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
    onToast("فایل خروجی آماده شد.");
  } catch (problem) {
    onToast(problem instanceof Error ? problem.message : "دریافت خروجی انجام نشد.", true);
  }
}

function StatusPill({ status }: { status: PriceList["status"] }) {
  const state: Record<PriceList["status"], { text: string; cls: string }> = {
    in_review: { text: "در حال بازبینی", cls: "pill-warn" },
    approved: { text: "تأییدشده", cls: "pill-success" },
    cancelled: { text: "لغوشده", cls: "" },
    error: { text: "دارای خطا", cls: "pill-danger" },
  };
  return <span className={`pill ${state[status].cls}`}>{state[status].text}</span>;
}

function PriceListTable({
  lists,
  totalCount,
  onReview,
  onToast,
  onRefresh,
}: {
  // The overview snapshot is used only as a refresh signal; this table owns its paged query.
  lists: PriceList[];
  totalCount: number;
  onReview: (id: string) => void;
  onToast: Props["onToast"];
  onRefresh: Props["onRefresh"];
}) {
  const [busyId, setBusyId] = useState("");
  const [rows, setRows] = useState<PriceList[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState<"all" | PriceList["status"]>("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (page === 1 && status === "all" && !appliedSearch) {
      setRows(lists);
      setTotal(totalCount);
    }
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
      q: appliedSearch,
      status,
    });
    try {
      const data = await api<{ rows: PriceList[]; total: number }>(
        `/api/pricelists?${params.toString()}`,
      );
      setRows(data.rows);
      setTotal(data.total);
    } catch (problem) {
      onToast(problem instanceof Error ? problem.message : "بارگذاری قیمت‌نامه‌ها انجام نشد.", true);
    } finally {
      setLoading(false);
    }
  }, [page, size, appliedSearch, status, onToast, lists, totalCount]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(id: string) {
    if (!window.confirm("این قیمت‌نامه لغو شود؟ قیمت جاری تغییر نمی‌کند.")) return;
    setBusyId(id);
    try {
      await api(`/api/pricelists/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      await onRefresh();
      await load();
      onToast("قیمت‌نامه لغو شد.");
    } catch (problem) {
      onToast(problem instanceof Error ? problem.message : "لغو قیمت‌نامه انجام نشد.", true);
    } finally {
      setBusyId("");
    }
  }
  return (
    <div className="panel">
      <div className="toolbar price-list-toolbar">
        <form
          className="toolbar-group"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setAppliedSearch(search.trim());
          }}
        >
          <label className="search-box">
            <Icon name="search" size={15} />
            <input
              aria-label="جست‌وجو در قیمت‌نامه‌ها"
              placeholder="عنوان، نام فایل یا تأمین‌کننده"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button className="btn btn-ghost btn-small" type="submit">
            جست‌وجو
          </button>
        </form>
        <select
          className="filter-select"
          aria-label="فیلتر وضعیت قیمت‌نامه‌ها"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="all">همهٔ وضعیت‌ها</option>
          <option value="in_review">در حال بازبینی</option>
          <option value="approved">تأییدشده</option>
          <option value="cancelled">لغوشده</option>
          <option value="error">دارای خطا</option>
        </select>
      </div>
      {loading ? (
        <Spinner label="در حال بارگذاری قیمت‌نامه‌ها" />
      ) : rows.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>قیمت‌نامه</th>
                <th>تأمین‌کننده</th>
                <th>تاریخ</th>
                <th>ردیف‌ها</th>
                <th>وضعیت</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((list) => (
                <tr key={list.id}>
                  <td>
                    <div className="product-name">
                      <span className="product-avatar icon-slot">
                        <Icon name="file" size={15} />
                      </span>
                      <div className="product-copy">
                        <strong>{list.title}</strong>
                        <span>{list.source_file_name}</span>
                      </div>
                    </div>
                  </td>
                  <td>{list.supplier_name}</td>
                  <td>{dateFa(list.source_date)}</td>
                  <td>
                    {new Intl.NumberFormat("fa-IR").format(Number(list.row_count))}
                    <span className="fine-print">
                      {list.status === "in_review"
                        ? ` · ${new Intl.NumberFormat("fa-IR").format(Number(list.pending_rows ?? 0))} باز`
                        : ""}
                    </span>
                  </td>
                  <td>
                    <StatusPill status={list.status} />
                  </td>
                  <td>
                    <div className="toolbar-group">
                      {list.status === "in_review" && (
                        <button
                          className="btn btn-primary btn-small"
                          onClick={() => onReview(list.id)}
                          type="button"
                        >
                          بازبینی ردیف‌ها
                        </button>
                      )}
                      {list.status === "approved" && (
                        <>
                          <button
                            className="btn btn-ghost btn-small"
                            onClick={() => void downloadExport(list.id, "csv", onToast)}
                            type="button"
                          >
                            <Icon name="download" size={13} /> CSV
                          </button>
                          <button
                            className="btn btn-ghost btn-small"
                            onClick={() => void downloadExport(list.id, "xlsx", onToast)}
                            type="button"
                          >
                            Excel
                          </button>
                        </>
                      )}
                      {list.status === "in_review" && (
                        <button
                          className="icon-button"
                          aria-label="لغو قیمت‌نامه"
                          title="لغو قیمت‌نامه"
                          disabled={busyId === list.id}
                          onClick={() => void cancel(list.id)}
                          type="button"
                        >
                          <Icon name="close" size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : total > 0 ? (
        <Empty icon="search" title="قیمت‌نامه‌ای پیدا نشد" text="جست‌وجو یا فیلتر را تغییر دهید." />
      ) : (
        <Empty
          icon="file"
          title="قیمت‌نامه‌ای وارد نشده"
          text="فایل تأمین‌کننده را بارگذاری کنید تا ستون‌ها را نگاشت و ردیف‌ها را بازبینی کنید."
        />
      )}
      <PaginationBar
        page={page}
        size={size}
        total={total}
        onPageChange={setPage}
        onSizeChange={(nextSize) => {
          setSize(nextSize);
          setPage(1);
        }}
      />
    </div>
  );
}

export function ReviewSection(props: Props) {
  const [openLists, setOpenLists] = useState<PriceList[]>([]);
  const [openListTotal, setOpenListTotal] = useState(0);
  const [openListPage, setOpenListPage] = useState(1);
  const [openListSize, setOpenListSize] = useState(10);
  const [openListSearch, setOpenListSearch] = useState("");
  const [appliedOpenListSearch, setAppliedOpenListSearch] = useState("");
  const [loadingOpenLists, setLoadingOpenLists] = useState(true);
  const [activeId, setActiveId] = useState(props.selectedPriceList ?? "");
  const [detail, setDetail] = useState<{
    list: PriceListDetail;
    rows: PriceRow[];
    total: number;
    page: number;
    size: number;
    summary: { pending_count: number; ready_count: number; skipped_count: number };
  } | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (openListPage === 1 && !appliedOpenListSearch) {
      setOpenLists(props.priceLists.filter((list) => list.status === "in_review").slice(0, openListSize));
    }
    setLoadingOpenLists(true);
    const params = new URLSearchParams({
      status: "in_review",
      page: String(openListPage),
      size: String(openListSize),
      q: appliedOpenListSearch,
    });
    api<{ rows: PriceList[]; total: number }>(`/api/pricelists?${params.toString()}`)
      .then((data) => {
        if (active) {
          setOpenLists(data.rows);
          setOpenListTotal(data.total);
        }
      })
      .catch((problem) => {
        if (active)
          props.onToast(
            problem instanceof Error ? problem.message : "فهرست قیمت‌نامه‌ها بارگذاری نشد.",
            true,
          );
      })
      .finally(() => {
        if (active) setLoadingOpenLists(false);
      });
    return () => {
      active = false;
    };
  }, [openListPage, openListSize, appliedOpenListSearch, props.priceLists, props.onToast]);

  useEffect(() => {
    if (!activeId && openLists.length) {
      setActiveId(openLists[0].id);
      props.onSelectPriceList(openLists[0].id);
    }
  }, [activeId, openLists, props.onSelectPriceList]);

  useEffect(() => {
    if (props.selectedPriceList && props.selectedPriceList !== activeId) {
      setActiveId(props.selectedPriceList);
      setPage(1);
      setSelectedRows(new Set());
    }
  }, [props.selectedPriceList, activeId]);

  const load = useCallback(async () => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    try {
      const data = await api<{
        list: PriceListDetail;
        rows: PriceRow[];
        total: number;
        page: number;
        size: number;
        summary: { pending_count: number; ready_count: number; skipped_count: number };
      }>(`/api/pricelists/${encodeURIComponent(activeId)}?page=${page}&size=${size}`);
      setDetail(data);
      setSelectedRows(
        (old) =>
          new Set(
            [...old].filter((id) =>
              data.rows.some(
                (row) => row.id === id && row.reviewed && !row.skipped && !row.approved_at,
              ),
            ),
          ),
      );
    } catch (problem) {
      props.onToast(
        problem instanceof Error ? problem.message : "بارگذاری ردیف‌ها انجام نشد.",
        true,
      );
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [activeId, page, size, props.onToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRow(
    row: PriceRow,
    input: { productId?: string; name?: string; price?: string; unit?: string; skip?: boolean },
  ) {
    setBusy(true);
    try {
      await api(
        `/api/pricelists/${encodeURIComponent(activeId)}/rows/${encodeURIComponent(row.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, reviewed: true }),
        },
      );
      await load();
      await props.onRefresh();
      props.onToast(input.skip ? "ردیف از پردازش کنار گذاشته شد." : "بازبینی ردیف ثبت شد.");
    } catch (problem) {
      props.onToast(problem instanceof Error ? problem.message : "ثبت بازبینی انجام نشد.", true);
    } finally {
      setBusy(false);
    }
  }

  const reviewable =
    detail?.rows.filter((row) => row.reviewed && !row.skipped && !row.approved_at) ?? [];
  const selected = reviewable.filter((row) => selectedRows.has(row.id));
  const impact = selected.reduce(
    (sum, row) => sum + (BigInt(row.price_rial ?? "0") - BigInt(row.current_cost_rial ?? "0")),
    0n,
  );
  async function approve() {
    setBusy(true);
    try {
      const result = await api<{ approvedRows: number; completed: boolean; pendingRows: number }>(
        `/api/pricelists/${encodeURIComponent(activeId)}/approve`,
        jsonBody({ rowIds: selected.map((row) => row.id), confirm: true }),
      );
      setConfirm(false);
      setSelectedRows(new Set());
      await props.onRefresh();
      await load();
      props.onToast(
        result.completed
          ? `${new Intl.NumberFormat("fa-IR").format(result.approvedRows)} تغییر تأیید شد.`
          : `${new Intl.NumberFormat("fa-IR").format(result.approvedRows)} تغییر تأیید شد؛ ${new Intl.NumberFormat("fa-IR").format(result.pendingRows)} ردیف باقی مانده است.`,
      );
    } catch (problem) {
      props.onToast(problem instanceof Error ? problem.message : "تأیید تغییرها انجام نشد.", true);
    } finally {
      setBusy(false);
    }
  }

  function toggleRow(id: string) {
    setSelectedRows((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedRows((old) =>
      old.size === reviewable.length ? new Set() : new Set(reviewable.map((row) => row.id)),
    );
  }

  if (!loadingOpenLists && openListTotal === 0 && !detail)
    return (
      <Empty
        icon="check"
        title="ردیفی برای بازبینی ندارید"
        text="قیمت‌نامهٔ جدید را وارد کنید. تا زمانی که شما تأیید نکنید، قیمت خرید کالاها تغییر نمی‌کند."
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>بازبینی قیمت‌ها</h2>
          <p>تطبیق پیشنهادی را بررسی کنید؛ ردیف مبهم خودکار تأیید نمی‌شود.</p>
        </div>
        {openListTotal > 0 && (
          <div className="review-list-picker">
            {openListTotal > 1 && (
              <form
                className="toolbar-group"
                onSubmit={(event) => {
                  event.preventDefault();
                  setAppliedOpenListSearch(openListSearch.trim());
                  setOpenListPage(1);
                }}
              >
                <label className="search-box">
                  <Icon name="search" size={15} />
                  <input
                    aria-label="جست‌وجوی قیمت‌نامه‌های در حال بازبینی"
                    placeholder="جست‌وجوی قیمت‌نامه"
                    value={openListSearch}
                    onChange={(event) => setOpenListSearch(event.target.value)}
                  />
                </label>
                <button className="btn btn-ghost btn-small" type="submit">
                  جست‌وجو
                </button>
              </form>
            )}
            <select
              className="filter-select"
              aria-label="قیمت‌نامه برای بازبینی"
              value={activeId}
              onChange={(event) => {
                setActiveId(event.target.value);
                props.onSelectPriceList(event.target.value);
                setPage(1);
                setSelectedRows(new Set());
              }}
            >
              {detail && !openLists.some((list) => list.id === detail.list.id) && (
                <option value={detail.list.id}>{detail.list.title} · {detail.list.supplier_name}</option>
              )}
              {openLists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.title} · {list.supplier_name}
                </option>
              ))}
            </select>
            {openListTotal > 1 && (
              <PaginationBar
                page={openListPage}
                size={openListSize}
                total={openListTotal}
                onPageChange={setOpenListPage}
                onSizeChange={(nextSize) => {
                  setOpenListSize(nextSize);
                  setOpenListPage(1);
                }}
              />
            )}
          </div>
        )}
      </div>
      {loadingOpenLists && !activeId ? (
        <Spinner label="در حال دریافت قیمت‌نامه‌های باز" />
      ) : loading ? (
        <Spinner label="در حال بارگذاری ردیف‌های قیمت‌نامه" />
      ) : detail ? (
        <>
          <div className="panel">
            <div className="panel-header">
              <div>
                <h3>{detail.list.title}</h3>
                <p>
                  {detail.list.supplier_name} · {dateFa(detail.list.source_date)} ·{" "}
                  {detail.list.currency === "IRT"
                    ? "فایل به تومان، ذخیره به ریال"
                    : "مبالغ به ریال"}
                </p>
              </div>
              <span className="pill pill-warn">
                {new Intl.NumberFormat("fa-IR").format(detail.total)} ردیف
              </span>
            </div>
          </div>
          <div className="review-summary">
            <div className="review-kpi">
              <span>نیازمند بازبینی</span>
              <strong>
                {new Intl.NumberFormat("fa-IR").format(
                  detail.summary.pending_count,
                )}
              </strong>
            </div>
            <div className="review-kpi">
              <span>آمادهٔ تأیید</span>
              <strong>{new Intl.NumberFormat("fa-IR").format(detail.summary.ready_count)}</strong>
            </div>
            <div className="review-kpi">
              <span>کنارگذاشته‌شده</span>
              <strong>
                {new Intl.NumberFormat("fa-IR").format(
                  detail.summary.skipped_count,
                )}
              </strong>
            </div>
          </div>
          <div className="panel">
            {detail.rows.length ? (
              <>
                <div className="panel-header">
                  <div>
                    <h3>ردیف‌های قیمت‌نامه</h3>
                    <p>کالا، قیمت خرید، واحد و هشدارها را بررسی کنید.</p>
                  </div>
                  <button
                    className="text-link"
                    onClick={toggleAll}
                    disabled={!reviewable.length}
                    type="button"
                  >
                    {selectedRows.size === reviewable.length && reviewable.length
                      ? "لغو انتخاب همه"
                      : "انتخاب ردیف‌های بازبینی‌شده"}
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="data-table review-table">
                    <thead>
                      <tr>
                        <th>تأیید</th>
                        <th>ردیف فایل</th>
                        <th>تغییر قیمت خرید</th>
                        <th>فروش و پیشنهاد قیمت</th>
                        <th>تطبیق و هشدار</th>
                        <th>بازبینی انسانی</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.rows.map((row) => (
                        <ReviewRow
                          key={row.id}
                          row={row}
                          list={detail.list}
                          settings={props.settings}
                          busy={busy}
                          selected={selectedRows.has(row.id)}
                          onToggle={() => toggleRow(row.id)}
                          onSave={(input) => saveRow(row, input)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationBar
                  page={page}
                  size={size}
                  total={detail.total}
                  onPageChange={(nextPage) => {
                    setPage(nextPage);
                    setSelectedRows(new Set());
                  }}
                  onSizeChange={(nextSize) => {
                    setSize(nextSize);
                    setPage(1);
                    setSelectedRows(new Set());
                  }}
                />
              </>
            ) : (
              <Empty
                icon="file"
                title="قیمت‌نامه ردیفی ندارد"
                text="فایل واردشده قابل بازبینی نیست."
              />
            )}
          </div>
          {selected.length > 0 && (
            <div className="approval-bar">
              <div>
                <strong>
                  {new Intl.NumberFormat("fa-IR").format(selected.length)} ردیف انتخاب شده
                </strong>
                <span style={{ display: "block" }}>
                  اثر خالص بر قیمت خرید: {impact > 0n ? "+" : ""}
                  {money(impact)} ریال
                </span>
              </div>
              <button className="btn btn-primary" onClick={() => setConfirm(true)} type="button">
                مرور نهایی تغییرها <Icon name="chevron" size={15} />
              </button>
            </div>
          )}
          {confirm && (
            <Modal
              title="تأیید نهایی قیمت‌های خرید"
              subtitle="پس از تأیید، قیمت خرید کالاها در همین شعبه به‌روز و تغییرها در تاریخچه ثبت می‌شوند."
              onClose={() => setConfirm(false)}
            >
              <p style={{ color: "#5f7067", fontSize: 12 }}>
                شما در حال تأیید{" "}
                <strong>{new Intl.NumberFormat("fa-IR").format(selected.length)} ردیف</strong> از «
                {detail.list.title}» هستید.
              </p>
              <div className="change-preview">
                <div>
                  <span>اثر خالص روی قیمت خرید</span>
                  <strong className={impact > 0n ? "change-up" : "change-down"}>
                    {impact > 0n ? "+" : ""}
                    {money(impact)} ریال
                  </strong>
                </div>
                <div>
                  <span>واحد پول ذخیره‌شده</span>
                  <strong>ریال</strong>
                </div>
              </div>
              <div className="formula-note">
                این اقدام برای هر کالا تراکنشی است. اگر قیمت فعلی از زمان بازبینی تغییر کرده باشد،
                همهٔ این تأیید متوقف می‌شود تا ردیف‌ها را دوباره بررسی کنید.
              </div>
              <div className="modal-foot">
                <button className="btn btn-ghost" onClick={() => setConfirm(false)} type="button">
                  برگشت به بازبینی
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void approve()}
                  type="button"
                >
                  {busy ? "در حال اعمال…" : "تأیید و اعمال تغییرها"}
                </button>
              </div>
            </Modal>
          )}
        </>
      ) : (
        <Empty
          icon="file"
          title="قیمت‌نامه‌ای انتخاب کنید"
          text="برای بازبینی، یکی از قیمت‌نامه‌های در انتظار را باز کنید."
        />
      )}
    </>
  );
}

function ReviewRow({
  row,
  list,
  settings,
  busy,
  selected,
  onToggle,
  onSave,
}: {
  row: PriceRow;
  list: PriceListDetail;
  settings: BranchSettings | null;
  busy: boolean;
  selected: boolean;
  onToggle: () => void;
  onSave: (input: {
    productId?: string;
    name?: string;
    price?: string;
    unit?: string;
    skip?: boolean;
  }) => Promise<void>;
}) {
  const [productId, setProductId] = useState(row.matched_product_id ?? "");
  const [name, setName] = useState(row.source_name);
  const [unit, setUnit] = useState(row.source_unit);
  const [price, setPrice] = useState(moneyForCurrency(row.price_rial, list.currency));
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<Product[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setProductId(row.matched_product_id ?? "");
    setName(row.source_name);
    setUnit(row.source_unit);
    setPrice(moneyForCurrency(row.price_rial, list.currency));
  }, [row.matched_product_id, row.source_name, row.source_unit, row.price_rial, list.currency]);
  useEffect(() => {
    if (search.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearchBusy(true);
      try {
        const result = await api<{ rows: Product[] }>(
          `/api/products?size=20&q=${encodeURIComponent(search)}`,
        );
        setFound(result.rows);
      } catch {
        setFound([]);
      } finally {
        setSearchBusy(false);
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search]);
  const options = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        sku: string;
        cost: string | null;
        sale: string | null;
        unit: string;
        confidence?: number;
        method?: string;
      }
    >();
    for (const item of row.suggestions)
      map.set(item.productId, {
        id: item.productId,
        name: item.name,
        sku: item.sku,
        cost: item.costPrice,
        sale: null,
        unit: item.unit,
        confidence: item.confidence,
        method: item.method,
      });
    for (const item of found)
      map.set(item.id, {
        id: item.id,
        name: item.name,
        sku: item.sku,
        cost: item.cost_price_rial,
        sale: item.sale_price_rial,
        unit: item.unit,
      });
    if (row.matched_product_id && row.matched_product_name && !map.has(row.matched_product_id))
      map.set(row.matched_product_id, {
        id: row.matched_product_id,
        name: row.matched_product_name,
        sku: row.matched_product_sku ?? "",
        cost: row.current_cost_rial,
        sale: row.current_sale_rial,
        unit: row.matched_product_unit ?? "",
      });
    return [...map.values()];
  }, [
    row.suggestions,
    row.matched_product_id,
    row.matched_product_name,
    row.matched_product_sku,
    row.current_cost_rial,
    row.current_sale_rial,
    row.matched_product_unit,
    found,
  ]);
  const chosen = options.find((option) => option.id === productId);
  const newRial = row.price_rial === null ? null : BigInt(row.price_rial);
  const oldRial = chosen?.cost ? BigInt(chosen.cost) : null;
  const delta = newRial === null ? null : newRial - (oldRial ?? 0n);
  const changePercent =
    newRial !== null && oldRial !== null && oldRial !== 0n
      ? Number(((newRial - oldRial) * 10_000n) / oldRial) / 100
      : null;
  const suggestedMargin =
    newRial !== null && settings
      ? roundPrice(
          marginSuggestedPrice(newRial, settings.margin_rate_bps),
          BigInt(settings.rounding_step),
        )
      : null;
  const suggestedMarkup =
    newRial !== null && settings
      ? roundPrice(
          markupSuggestedPrice(newRial, settings.markup_rate_bps),
          BigInt(settings.rounding_step),
        )
      : null;
  const warnings = row.warning_codes.map((warning) => warningLabels[warning] ?? warning);
  const reviewedStatus = row.approved_at
    ? "اعمال‌شده"
    : row.skipped
      ? "کنار گذاشته شد"
      : row.reviewed
        ? "بازبینی شد"
        : "بازبینی نشده";
  async function review() {
    setError("");
    try {
      await onSave({ productId, name, price, unit });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "بازبینی انجام نشد.");
    }
  }
  async function skip() {
    setError("");
    try {
      await onSave({ skip: true });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "کنارگذاشتن ردیف انجام نشد.");
    }
  }

  return (
    <tr>
      <td>
        {row.reviewed && !row.skipped && !row.approved_at ? (
          <input
            type="checkbox"
            aria-label={`انتخاب ردیف ${row.source_row} برای تأیید`}
            checked={selected}
            onChange={onToggle}
          />
        ) : (
          <span
            className={`pill ${row.approved_at ? "pill-success" : row.skipped ? "" : "pill-warn"}`}
          >
            {reviewedStatus}
          </span>
        )}
      </td>
      <td>
        <div className="review-row-title">
          <strong>{row.source_name || "نام نامشخص"}</strong>
          <span>
            {[
              row.source_sku && `کد ${row.source_sku}`,
              row.source_barcode && `بارکد ${row.source_barcode}`,
              row.source_brand,
              row.source_model,
            ]
              .filter(Boolean)
              .join(" · ") || `ردیف ${new Intl.NumberFormat("fa-IR").format(row.source_row)}`}
          </span>
          <span>واحد فایل: {row.source_unit || "نامشخص"}</span>
        </div>
      </td>
      <td>
        <div className="price-pair">
          <span>قیمت فعلی / پیشنهادی · ریال</span>
          <strong>
            {money(oldRial)} ← {money(newRial)}
          </strong>
          {delta !== null && (
            <span className={delta > 0n ? "change-up" : "change-down"}>
              {delta > 0n ? "+" : ""}
              {money(delta)} ریال
              {changePercent !== null
                ? ` · ${changePercent > 0 ? "+" : ""}${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 }).format(changePercent)}٪`
                : ""}
            </span>
          )}
        </div>
      </td>
      <td>
        <div className="price-pair">
          <span>قیمت فروش فعلی · ریال</span>
          <strong>{money(chosen?.sale ?? row.current_sale_rial)}</strong>
          <span>پیشنهاد حاشیهٔ سود: {money(suggestedMargin)} ریال</span>
          <span>پیشنهاد افزایش روی بها: {money(suggestedMarkup)} ریال</span>
        </div>
      </td>
      <td>
        <div className="price-pair">
          <span>اطمینان تطبیق</span>
          <strong>
            {row.confidence
              ? `${new Intl.NumberFormat("fa-IR").format(row.confidence)}٪ · ${row.match_method === "barcode" ? "بارکد" : row.match_method === "sku" ? "کد کالا" : row.match_method === "manual" ? "انتخاب دستی" : "نام"}`
              : "بدون تطبیق"}
          </strong>
          <div className="warning-stack">
            {warnings.map((warning) => (
              <span className="pill pill-warn" key={warning}>
                <Icon name="warning" size={11} />
                {warning}
              </span>
            ))}
          </div>
        </div>
      </td>
      <td>
        <div className="review-actions">
          <input
            aria-label={`نام کالا در قیمت‌نامه، ردیف ${row.source_row}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="نام کالا"
            disabled={Boolean(row.approved_at)}
          />
          <input
            aria-label={`جست‌وجوی کالا برای ردیف ${row.source_row}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="جست‌وجوی کالای خودتان"
            disabled={Boolean(row.approved_at)}
          />
          {searchBusy && <span className="fine-print">در حال جست‌وجو…</span>}
          <select
            aria-label={`کالای متناظر ردیف ${row.source_row}`}
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            disabled={Boolean(row.approved_at)}
          >
            <option value="">انتخاب کالا</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.sku ? ` · ${option.sku}` : ""}
                {option.confidence !== undefined ? ` · ${option.confidence}٪` : ""}
              </option>
            ))}
          </select>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 75px", gap: 5 }}>
            <input
              aria-label={`قیمت پیشنهادی ردیف ${row.source_row}`}
              inputMode="numeric"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="قیمت"
              disabled={Boolean(row.approved_at)}
            />
            <input
              aria-label={`واحد ردیف ${row.source_row}`}
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              placeholder="واحد"
              disabled={Boolean(row.approved_at)}
            />
          </div>
          {!row.approved_at && (
            <>
              <button
                className="btn btn-primary btn-small"
                onClick={() => void review()}
                disabled={busy || !productId}
                type="button"
              >
                تأیید بازبینی ردیف
              </button>
              <button
                className="btn btn-ghost btn-small"
                onClick={() => void skip()}
                disabled={busy}
                type="button"
              >
                کنارگذاشتن از پردازش
              </button>
            </>
          )}
          {error && <span className="error-text">{error}</span>}
          {row.reviewed && !row.approved_at && !row.skipped && (
            <span className="pill pill-success">{reviewedStatus}</span>
          )}
        </div>
      </td>
    </tr>
  );
}

export function HistorySection(props: Props) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    if (page === 1) setEvents(props.history);
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    api<{ rows: HistoryEvent[]; total: number }>(`/api/history?${params.toString()}`)
      .then((data) => {
        if (active) {
          setEvents(data.rows);
          setTotal(data.total);
        }
      })
      .catch((problem) => {
        if (active)
          props.onToast(
            problem instanceof Error ? problem.message : "دریافت تاریخچه انجام نشد.",
            true,
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, size, props.history, props.onToast]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>تاریخچهٔ این شعبه</h2>
          <p>قیمت‌های تأییدشده، ورود فایل‌ها و خروجی‌های دریافت‌شده</p>
        </div>
        <span className="pill">
          <Icon name="shield" size={13} /> رویدادها قابل ویرایش نیستند
        </span>
      </div>
      <div className="panel" style={{ marginBottom: 18 }}>
        {loading ? (
          <Spinner label="در حال دریافت رویدادها" />
        ) : events.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>رویداد</th>
                  <th>شرح</th>
                  <th>تغییر قیمت خرید</th>
                  <th>زمان</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <HistoryRow key={event.id} event={event} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon="clock"
            title="تاریخچه هنوز خالی است"
            text="پس از ورود فایل یا تأیید تغییر قیمت، رویداد اینجا ثبت می‌شود."
          />
        )}
        <PaginationBar
          page={page}
          size={size}
          total={total}
          onPageChange={setPage}
          onSizeChange={(nextSize) => {
            setSize(nextSize);
            setPage(1);
          }}
        />
      </div>
      <div className="section-heading">
        <div>
          <h2>قیمت‌نامه‌ها</h2>
          <p>دریافت خروجی فقط برای قیمت‌نامهٔ تأییدشده فعال است.</p>
        </div>
      </div>
      <PriceListTable
        lists={props.priceLists}
        totalCount={props.priceListTotal}
        onReview={(id) => {
          props.onSelectPriceList(id);
          props.onSection("review");
        }}
        onToast={props.onToast}
        onRefresh={props.onRefresh}
      />
    </>
  );
}

function HistoryRow({ event }: { event: HistoryEvent }) {
  const eventLabels: Record<string, string> = {
    "business.created": "ساخت کسب‌وکار",
    "product.created": "افزودن کالا",
    "product.category_assigned": "افزودن کالا به دسته‌بندی",
    "product.category_changed": "تغییر دسته‌بندی کالا",
    "product.category_removed": "خروج کالا از دسته‌بندی",
    "product_category.created": "ساخت دسته‌بندی کالا",
    "product_category.updated": "ویرایش دسته‌بندی کالا",
    "product_category.deleted": "حذف دسته‌بندی کالا",
    "products.imported": "ورود فهرست کالاها",
    "supplier.created": "افزودن تأمین‌کننده",
    "price_list.imported": "ورود قیمت‌نامه",
    "price_list.row_reviewed": "بازبینی ردیف",
    "price_list.row_skipped": "کنارگذاشتن ردیف",
    "product.purchase_price_approved": "تأیید قیمت خرید",
    "price_list.approval_batch": "اعمال مجموعه تغییرها",
    "price_list.exported": "دریافت خروجی",
    "price_list.cancelled": "لغو قیمت‌نامه",
    "branch.settings_updated": "تغییر تنظیمات قیمت",
  };
  const details = event.details ?? {};
  const before = typeof details.previousPriceRial === "string" ? details.previousPriceRial : null;
  const after = typeof details.newPriceRial === "string" ? details.newPriceRial : null;
  const context =
    typeof details.productName === "string"
      ? details.productName
      : typeof details.categoryName === "string"
        ? details.categoryName
        : typeof details.name === "string"
          ? details.name
          : typeof details.title === "string"
            ? details.title
            : typeof details.fileName === "string"
              ? details.fileName
              : typeof details.rows === "number"
                ? `${new Intl.NumberFormat("fa-IR").format(details.rows)} ردیف`
                : "—";
  return (
    <tr>
      <td>
        <span
          className={`pill ${event.event_type.includes("approved") ? "pill-success" : event.event_type.includes("cancelled") ? "pill-danger" : ""}`}
        >
          {eventLabels[event.event_type] ?? "فعالیت"}
        </span>
      </td>
      <td>{context}</td>
      <td>
        {before !== null && after !== null ? (
          <span className="price-pair">
            <strong>
              {money(before)} ← {money(after)} ریال
            </strong>
          </span>
        ) : (
          "—"
        )}
      </td>
      <td>{dateFa(event.created_at, "long")}</td>
    </tr>
  );
}

export function SettingsSection(props: Props) {
  const settings = props.settings;
  const [margin, setMargin] = useState(settings ? String(settings.margin_rate_bps / 100) : "20");
  const [markup, setMarkup] = useState(settings ? String(settings.markup_rate_bps / 100) : "25");
  const [rounding, setRounding] = useState(settings?.rounding_step ?? "1000");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (settings) {
      setMargin(String(settings.margin_rate_bps / 100));
      setMarkup(String(settings.markup_rate_bps / 100));
      setRounding(settings.rounding_step);
    }
  }, [settings]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marginRateBps: Math.round(Number(margin) * 100),
          markupRateBps: Math.round(Number(markup) * 100),
          roundingStep: rounding,
        }),
      });
      await props.onRefresh();
      props.onToast("تنظیمات این شعبه ذخیره شد.");
    } catch (problem) {
      props.onToast(problem instanceof Error ? problem.message : "ذخیرهٔ تنظیمات انجام نشد.", true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>تنظیمات قیمت</h2>
          <p>قواعد این صفحه فقط پیشنهاد می‌سازند و قیمت فروش را تغییر نمی‌دهند.</p>
        </div>
      </div>
      <section className="settings-card appearance-card" aria-labelledby="appearance-title">
        <div>
          <h3 id="appearance-title">ظاهر سامانه</h3>
          <p>
            تنظیم‌های ظاهری شعبهٔ «{props.session.activeBranch?.name}» در همین مرورگر ذخیره می‌شوند.
          </p>
        </div>
        <div className="appearance-controls">
          <div className="appearance-control">
            <span className="appearance-label">تم رنگی</span>
            <div className="appearance-mode-options" role="group" aria-label="انتخاب تم رنگی">
              <button
                className={`appearance-mode-button${props.appearance.mode === "light" ? " active" : ""}`}
                type="button"
                aria-pressed={props.appearance.mode === "light"}
                onClick={() => props.onAppearanceChange({ ...props.appearance, mode: "light" })}
              >
                <Icon name="sun" size={16} /> روشن
              </button>
              <button
                className={`appearance-mode-button${props.appearance.mode === "dark" ? " active" : ""}`}
                type="button"
                aria-pressed={props.appearance.mode === "dark"}
                onClick={() => props.onAppearanceChange({ ...props.appearance, mode: "dark" })}
              >
                <Icon name="moon" size={16} /> تاریک
              </button>
            </div>
          </div>
          <label className="appearance-control appearance-color-control">
            <span className="appearance-label">رنگ اصلی شعبه</span>
            <span className="appearance-color-field">
              <input
                type="color"
                value={props.appearance.accentColor}
                aria-label="انتخاب رنگ اصلی شعبه"
                onChange={(event) =>
                  props.onAppearanceChange({ ...props.appearance, accentColor: event.target.value })
                }
              />
              <span dir="ltr">{props.appearance.accentColor.toUpperCase()}</span>
            </span>
          </label>
          <label className="appearance-control">
            <span className="appearance-label">قلم فارسی</span>
            <select
              className="appearance-select"
              value={props.appearance.fontFamily}
              onChange={(event) =>
                props.onAppearanceChange({
                  ...props.appearance,
                  fontFamily: event.target.value === "system" ? "system" : "vazirmatn",
                })
              }
            >
              <option value="vazirmatn">وزیرمتن</option>
              <option value="system">قلم سیستم</option>
            </select>
          </label>
        </div>
      </section>
      {!settings ? (
        <div className="panel">
          <Empty
            icon="settings"
            title="تنظیمات در دسترس نیست"
            text="برای شعبه تنظیمات پایه پیدا نشد. صفحه را دوباره بارگذاری کنید."
          />
        </div>
      ) : (
        <>
          <form className="settings-card" onSubmit={save}>
            <h3>پیشنهاد قیمت فروش</h3>
            <p>این تنظیمات فقط برای شعبهٔ فعال ذخیره می‌شوند.</p>
            <div className="form-grid">
              <Field label="حاشیهٔ سود ناخالص هدف (درصد)">
                <input
                  type="number"
                  min="0"
                  max="95"
                  step="0.1"
                  value={margin}
                  onChange={(event) => setMargin(event.target.value)}
                />
              </Field>
              <Field label="افزایش روی بهای خرید (درصد)">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={markup}
                  onChange={(event) => setMarkup(event.target.value)}
                />
              </Field>
              <Field label="گام گردکردن قیمت (ریال)">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={rounding}
                  onChange={(event) => setRounding(event.target.value)}
                />
              </Field>
            </div>
            <div className="formula-note" style={{ marginTop: 14 }}>
              حاشیهٔ سود ناخالص: قیمت فروش = بهای خرید ÷ (۱ − نرخ حاشیهٔ سود).
              <br />
              افزایش روی بهای خرید: قیمت فروش = بهای خرید × (۱ + نرخ افزایش).
              <br />
              این دو محاسبه یکسان نیستند. گردکردن فقط پیشنهاد را تغییر می‌دهد و هیچ قیمتی بدون تأیید
              جداگانه عوض نمی‌شود.
            </div>
            <div className="modal-foot">
              <button className="btn btn-primary" disabled={busy} type="submit">
                {busy ? "در حال ذخیره…" : "ذخیرهٔ تنظیمات"}
              </button>
            </div>
          </form>
          <div className="settings-card">
            <h3>واحد ذخیره‌سازی مبلغ</h3>
            <p>
              تمام مبلغ‌ها در پایگاه داده به ریالِ صحیح نگه‌داری می‌شوند. ورود فایل با واحد تومان، هنگام
              پردازش به ریال × ۱۰ تبدیل می‌شود. نمایش قیمت‌ها همراه با واحد پول انجام می‌شود.
            </p>
            <span className="pill pill-success">بدون محاسبهٔ اعشاری شناور</span>
          </div>
        </>
      )}
    </>
  );
}
