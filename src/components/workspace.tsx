"use client";

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { api, jsonBody, dateFa } from "@/lib/client";
import { AuthScreen } from "@/components/auth";
import { Icon, Modal, Spinner, Toast } from "@/components/ui";
import {
  ProductsSection,
  SuppliersSection,
  ImportsSection,
  ReviewSection,
  HistorySection,
  SettingsSection,
} from "@/components/sections";
import type {
  BranchSettings,
  HistoryEvent,
  PriceList,
  Product,
  Section,
  SessionData,
  Supplier,
} from "@/components/types";

const nav: { section: Section; label: string; icon: string }[] = [
  { section: "overview", label: "نمای کلی", icon: "grid" },
  { section: "products", label: "کالاها", icon: "box" },
  { section: "suppliers", label: "تأمین‌کنندگان", icon: "users" },
  { section: "imports", label: "ورود قیمت‌نامه", icon: "upload" },
  { section: "review", label: "بازبینی تغییرها", icon: "file" },
  { section: "history", label: "تاریخچه و خروجی", icon: "clock" },
  { section: "settings", label: "تنظیمات قیمت", icon: "settings" },
];

const titles: Record<Section, { title: string; description: string }> = {
  overview: { title: "نمای کلی", description: "وضعیت کالاها و کارهایی که نیاز به پیگیری دارند" },
  products: { title: "کالاها", description: "فهرست کالاهای همین شعبه و قیمت‌های فعلی" },
  suppliers: { title: "تأمین‌کنندگان", description: "فهرست تأمین‌کنندگان ثبت‌شده در همین شعبه" },
  imports: {
    title: "ورود قیمت‌نامه",
    description: "فایل تأمین‌کننده را بارگذاری و ستون‌ها را نگاشت کنید",
  },
  review: {
    title: "بازبینی تغییرها",
    description: "پیش از اعمال، کالا و قیمت پیشنهادی را بررسی کنید",
  },
  history: { title: "تاریخچه و خروجی", description: "تغییرهای تأییدشده و رویدادهای همین شعبه" },
  settings: { title: "تنظیمات قیمت", description: "قواعد پیشنهادی برای محاسبهٔ قیمت فروش" },
};

export type Props = {
  session: SessionData;
  products: Product[];
  productTotal: number;
  suppliers: Supplier[];
  priceLists: PriceList[];
  history: HistoryEvent[];
  settings: BranchSettings | null;
  loading: boolean;
  section: Section;
  selectedPriceList: string | null;
  onSection: (section: Section) => void;
  onSelectPriceList: (id: string | null) => void;
  onRefresh: () => Promise<void>;
  onToast: (message: string, error?: boolean) => void;
};

export function Workspace() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [booting, setBooting] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [page, setPage] = useState<Section>("overview");
  const [products, setProducts] = useState<Product[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [settings, setSettings] = useState<BranchSettings | null>(null);
  const [selectedPriceList, setSelectedPriceList] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [bootError, setBootError] = useState("");
  const [creationDialog, setCreationDialog] = useState<"business" | "branch" | null>(null);
  const authenticated = session?.authenticated;
  const activeBranchId = session?.activeBranch?.id;

  function clearBranchData() {
    setProducts([]);
    setProductTotal(0);
    setSuppliers([]);
    setPriceLists([]);
    setHistory([]);
    setSettings(null);
    setSelectedPriceList(null);
  }

  const refreshSession = useCallback(async () => {
    const data = await api<SessionData>("/api/auth/session");
    setSession(data);
    setBootError("");
    return data;
  }, []);

  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    window.setTimeout(() => setToast(null), 3600);
  }, []);

  const refreshData = useCallback(async () => {
    if (!authenticated || !activeBranchId) return;
    setLoadingData(true);
    try {
      const [productsData, suppliersData, listsData, historyData, settingsData] = await Promise.all(
        [
          api<{ rows: Product[]; total: number }>("/api/products?size=50"),
          api<{ rows: Supplier[] }>("/api/suppliers"),
          api<{ rows: PriceList[] }>("/api/pricelists"),
          api<{ rows: HistoryEvent[] }>("/api/history?size=8"),
          api<BranchSettings>("/api/settings"),
        ],
      );
      setProducts(productsData.rows);
      setProductTotal(productsData.total);
      setSuppliers(suppliersData.rows);
      setPriceLists(listsData.rows);
      setHistory(historyData.rows);
      setSettings(settingsData);
      setSelectedPriceList((current) =>
        current && listsData.rows.some((list) => list.id === current && list.status === "in_review")
          ? current
          : (listsData.rows.find((list) => list.status === "in_review")?.id ?? null),
      );
    } catch (problem) {
      notify(problem instanceof Error ? problem.message : "بارگذاری اطلاعات انجام نشد.", true);
    } finally {
      setLoadingData(false);
    }
  }, [authenticated, activeBranchId, notify]);

  useEffect(() => {
    let current = true;
    api<SessionData>("/api/auth/session")
      .then((data) => {
        if (current) setSession(data);
      })
      .catch((problem) => {
        if (current)
          setBootError(problem instanceof Error ? problem.message : "اتصال به سامانه برقرار نشد.");
      })
      .finally(() => {
        if (current) setBooting(false);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (authenticated && activeBranchId) void refreshData();
  }, [authenticated, activeBranchId, refreshData]);

  const businesses = session?.businesses ?? [];
  const activeBusiness = useMemo(
    () => businesses.find((business) => business.id === session?.activeBranch?.businessId) ?? null,
    [businesses, session?.activeBranch?.businessId],
  );
  const pendingLists = priceLists.filter((list) => list.status === "in_review").length;

  async function switchContext(branchId: string) {
    try {
      await api("/api/context", jsonBody({ branchId }));
      clearBranchData();
      setPage("overview");
      await refreshSession();
    } catch (problem) {
      notify(problem instanceof Error ? problem.message : "تغییر شعبه انجام نشد.", true);
    }
  }

  async function createBusiness(name: string) {
    try {
      await api("/api/businesses", jsonBody({ name }));
      clearBranchData();
      await refreshSession();
      setPage("overview");
      notify("کسب‌وکار و شعبهٔ اصلی ساخته شد.");
    } catch (problem) {
      notify(problem instanceof Error ? problem.message : "ساخت کسب‌وکار انجام نشد.", true);
      throw problem;
    }
  }

  async function createBranch(name: string) {
    if (!activeBusiness) throw new Error("ابتدا یک کسب‌وکار انتخاب کنید.");
    try {
      const created = await api<{ id: string }>(
        "/api/branches",
        jsonBody({ businessId: activeBusiness.id, name }),
      );
      await api("/api/context", jsonBody({ branchId: created.id }));
      clearBranchData();
      await refreshSession();
      setPage("overview");
      notify("شعبه ساخته و انتخاب شد.");
    } catch (problem) {
      notify(problem instanceof Error ? problem.message : "ساخت شعبه انجام نشد.", true);
      throw problem;
    }
  }

  if (booting) return <Spinner label="در حال آماده‌سازی بهابان" />;
  if (bootError && !session)
    return (
      <main className="auth-main">
        <div className="auth-card">
          <span className="pill pill-danger">اتصال برقرار نشد</span>
          <h1 style={{ marginTop: 12 }}>بهابان آماده نیست</h1>
          <p>{bootError}</p>
          <p className="fine-print">
            پیکربندی پایگاه داده و migration را طبق راهنمای پروژه بررسی کنید.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => window.location.reload()}
            type="button"
          >
            تلاش دوباره
          </button>
        </div>
      </main>
    );
  if (!session?.authenticated)
    return (
      <AuthScreen
        onAuthenticated={() => {
          void refreshSession()
            .then(() => setPage("overview"))
            .catch((problem) => notify(problem.message, true));
        }}
      />
    );
  if (businesses.length === 0)
    return <Onboarding onCreate={createBusiness} phone={session.user?.phone ?? ""} />;
  if (!session.activeBranch || !activeBusiness)
    return (
      <main className="main-area">
        <div className="onboarding">
          <span className="pill pill-warn">زمینهٔ کاری انتخاب نشده</span>
          <h2>یک شعبه انتخاب کنید</h2>
          <p>از منوی بالای صفحه کسب‌وکار و شعبهٔ مورد نظر را انتخاب کنید.</p>
        </div>
      </main>
    );

  const dataProps: Props = {
    session,
    products,
    productTotal,
    suppliers,
    priceLists,
    history,
    settings,
    loading: loadingData,
    section: page,
    selectedPriceList,
    onSection: setPage,
    onSelectPriceList: setSelectedPriceList,
    onRefresh: refreshData,
    onToast: notify,
  };

  return (
    <div className="app-shell">
      {mobileNav && (
        <div className="sidebar-backdrop" onClick={() => setMobileNav(false)} aria-hidden="true" />
      )}
      <aside className={`sidebar${mobileNav ? " open" : ""}`} aria-label="ناوبری اصلی">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="chart" size={22} />
          </span>
          <div>
            <div className="brand-name">بهابان</div>
            <div className="brand-subtitle">مدیریت هوشمند قیمت خرید</div>
          </div>
        </div>
        <div className="nav-caption">فضای کاری</div>
        <nav className="nav-group">
          {nav.map((item) => (
            <button
              key={item.section}
              className={`nav-item${page === item.section ? " active" : ""}`}
              onClick={() => {
                setPage(item.section);
                setMobileNav(false);
              }}
              aria-current={page === item.section ? "page" : undefined}
              type="button"
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {item.section === "review" && pendingLists > 0 && (
                <span className="pill pill-warn" style={{ marginInlineStart: "auto" }}>
                  {new Intl.NumberFormat("fa-IR").format(pendingLists)}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-card">
            <strong>کنترل تغییر قیمت دست شماست</strong>
            <span>قیمت جاری فقط پس از تأیید صریح به‌روز می‌شود.</span>
          </div>
          <div className="user-row">
            <div className="avatar">ب</div>
            <div className="user-detail">
              <strong>حساب کاربری</strong>
              <span>{session.user?.phone}</span>
            </div>
            <button
              className="icon-button"
              title="خروج از حساب"
              aria-label="خروج از حساب"
              onClick={async () => {
                try {
                  await api("/api/auth/logout", { method: "POST" });
                  clearBranchData();
                  setSession({ authenticated: false });
                } catch (problem) {
                  notify(problem instanceof Error ? problem.message : "خروج انجام نشد.", true);
                }
              }}
              type="button"
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobileNav(true)}
            aria-label="بازکردن منو"
            type="button"
          >
            <Icon name="menu" size={18} />
          </button>
          <div className="topbar-title">
            <h1>{titles[page].title}</h1>
            <p>{titles[page].description}</p>
          </div>
          <div className="context-selectors">
            <label className="select-wrap">
              <Icon name="store" size={15} />
              <span className="sr-only">کسب‌وکار</span>
              <select
                aria-label="کسب‌وکار"
                value={activeBusiness.id}
                onChange={(event) => {
                  const business = businesses.find((item) => item.id === event.target.value);
                  const primary =
                    business?.branches.find((branch) => branch.isPrimary) ?? business?.branches[0];
                  if (primary) void switchContext(primary.id);
                }}
              >
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>
                    {business.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label="ساخت کسب‌وکار جدید"
              title="ساخت کسب‌وکار جدید"
              onClick={() => setCreationDialog("business")}
            >
              <Icon name="plus" size={16} />
            </button>
            <label className="select-wrap">
              <Icon name="branch" size={15} />
              <span className="sr-only">شعبه</span>
              <select
                aria-label="شعبه"
                value={session.activeBranch.id}
                onChange={(event) => void switchContext(event.target.value)}
              >
                {activeBusiness.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                    {branch.isPrimary ? " · اصلی" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label="افزودن شعبه به این کسب‌وکار"
              title="افزودن شعبه"
              onClick={() => setCreationDialog("branch")}
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          <div className="topbar-actions">
            <span className="pill pill-success desktop-only">
              <span aria-hidden="true">●</span> فضای امن شعبه
            </span>
          </div>
        </header>
        <div className="content">
          <SectionView {...dataProps} />
        </div>
      </main>
      {toast && <Toast message={toast.message} error={toast.error} />}
      {creationDialog === "business" && (
        <CreateWorkspaceDialog
          kind="business"
          onClose={() => setCreationDialog(null)}
          onCreate={createBusiness}
        />
      )}
      {creationDialog === "branch" && (
        <CreateWorkspaceDialog
          kind="branch"
          onClose={() => setCreationDialog(null)}
          onCreate={createBranch}
        />
      )}
    </div>
  );
}

function CreateWorkspaceDialog({
  kind,
  onClose,
  onCreate,
}: {
  kind: "business" | "branch";
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const inputId = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const business = kind === "business";
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onCreate(name);
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "ثبت انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={business ? "ساخت کسب‌وکار جدید" : "افزودن شعبه"}
      subtitle={
        business
          ? "برای هر کسب‌وکار شعبهٔ اصلی جداگانه ساخته می‌شود."
          : "اطلاعات این شعبه از شعبه‌های دیگر جدا می‌ماند."
      }
      onClose={onClose}
      width={460}
    >
      <form className="form-grid" onSubmit={submit}>
        <div className="field full">
          <label htmlFor={inputId}>{business ? "نام کسب‌وکار" : "نام شعبه"}</label>
          <input
            id={inputId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={120}
            required
          />
        </div>
        {error && (
          <p className="field full error-text" role="alert">
            {error}
          </p>
        )}
        <div className="field full modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "در حال ثبت…" : business ? "ساخت کسب‌وکار" : "ساخت شعبه"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Onboarding({
  onCreate,
  phone,
}: {
  onCreate: (name: string) => Promise<void>;
  phone: string;
}) {
  const inputId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onCreate(name);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "ساخت کسب‌وکار انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="main-area">
      <div className="onboarding">
        <span className="pill pill-success">شروع فضای کاری</span>
        <h2>اولین کسب‌وکارتان را بسازید</h2>
        <p>بعد از ثبت نام، شعبهٔ اصلی به شکل خودکار ایجاد و برای شروع انتخاب می‌شود.</p>
        <div className="step-list">
          <div className="step-row">
            <span className="step-number">۱</span>
            <div>
              <strong>نام کسب‌وکار</strong>
              <span>برای نمونه نام فروشگاه یا شرکت خود را وارد کنید.</span>
            </div>
          </div>
          <div className="step-row">
            <span className="step-number">۲</span>
            <div>
              <strong>افزودن کالاها</strong>
              <span>فهرست فعلی را وارد کنید یا کالاها را دستی بسازید.</span>
            </div>
          </div>
          <div className="step-row">
            <span className="step-number">۳</span>
            <div>
              <strong>ورود اولین قیمت‌نامه</strong>
              <span>تأمین‌کننده را انتخاب کنید و فایل قیمت را بازبینی کنید.</span>
            </div>
          </div>
        </div>
        <form onSubmit={submit} className="form-grid">
          <div className="field full">
            <label htmlFor={inputId}>نام کسب‌وکار</label>
            <input
              id={inputId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              minLength={2}
              maxLength={120}
              placeholder="مثلاً فروشگاه بهار"
            />
          </div>
          <div className="field full">
            <span className="field-hint">
              حساب {phone} مالک این کسب‌وکار خواهد بود. دعوت همکاران در نسخهٔ بعدی اضافه می‌شود.
            </span>
          </div>
          {error && (
            <p className="field full error-text" role="alert">
              {error}
            </p>
          )}
          <div className="field full">
            <button className="btn btn-primary" disabled={busy} type="submit">
              {busy ? (
                <>
                  <i className="spinner" /> در حال ساخت
                </>
              ) : (
                <>
                  ساخت کسب‌وکار و شعبهٔ اصلی <Icon name="chevron" size={15} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function SectionView(props: Props) {
  switch (props.section) {
    case "products":
      return <ProductsSection {...props} />;
    case "suppliers":
      return <SuppliersSection {...props} />;
    case "imports":
      return <ImportsSection {...props} />;
    case "review":
      return <ReviewSection {...props} />;
    case "history":
      return <HistorySection {...props} />;
    case "settings":
      return <SettingsSection {...props} />;
    default:
      return <Overview {...props} />;
  }
}

function Overview({
  session,
  productTotal,
  priceLists,
  history,
  loading,
  onSection,
  onSelectPriceList,
}: Props) {
  const pending = priceLists.filter((item) => item.status === "in_review");
  const approved = priceLists.filter((item) => item.status === "approved");
  const lastPrice = history.find((item) => item.event_type === "product.purchase_price_approved");
  const active = session.activeBranch;
  return (
    <>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <span className="eyebrow">{dateFa(new Date(), "short")} · فضای کاری شما</span>
          <h2>{active?.businessName}، خوش آمدید</h2>
          <p>
            {pending.length
              ? `${new Intl.NumberFormat("fa-IR").format(pending.length)} قیمت‌نامه برای بازبینی دارید.`
              : "قیمت‌نامهٔ جدید را وارد کنید یا فهرست کالاها را کامل کنید."}
          </p>
          <div className="welcome-actions">
            <button className="btn btn-white" onClick={() => onSection("imports")} type="button">
              <Icon name="upload" size={15} /> ورود قیمت‌نامه
            </button>
            <button
              className="btn"
              style={{
                color: "white",
                borderColor: "rgba(255,255,255,.35)",
                background: "transparent",
              }}
              onClick={() => onSection("products")}
              type="button"
            >
              <Icon name="box" size={15} /> فهرست کالاها
            </button>
          </div>
        </div>
        <div className="welcome-illustration" aria-hidden="true">
          <Icon name="chart" size={42} />
        </div>
      </section>
      <div className="section-heading">
        <div>
          <h2>وضعیت این شعبه</h2>
          <p>اطلاعات فقط برای {active?.name} نمایش داده می‌شود.</p>
        </div>
        <span className="pill">
          <Icon name="shield" size={13} /> دسترسی محدود به شعبه
        </span>
      </div>
      <section className="stats-grid" aria-label="آمار شعبه">
        <Stat
          icon="box"
          label="کالاهای ثبت‌شده"
          value={loading ? "…" : new Intl.NumberFormat("fa-IR").format(productTotal)}
          foot="در فهرست این شعبه"
        />
        <Stat
          icon="file"
          label="در انتظار بازبینی"
          value={loading ? "…" : new Intl.NumberFormat("fa-IR").format(pending.length)}
          foot={
            pending.reduce((sum, list) => sum + Number(list.pending_rows ?? 0), 0)
              ? `${new Intl.NumberFormat("fa-IR").format(pending.reduce((sum, list) => sum + Number(list.pending_rows ?? 0), 0))} ردیف نیازمند بررسی`
              : "همهٔ ردیف‌ها بررسی شده‌اند"
          }
        />
        <Stat
          icon="check"
          label="قیمت‌نامهٔ تأییدشده"
          value={loading ? "…" : new Intl.NumberFormat("fa-IR").format(approved.length)}
          foot="تاریخچهٔ هر تغییر ثبت می‌شود"
        />
        <Stat
          icon="chart"
          label="آخرین تغییر خرید"
          value={lastPrice ? dateFa(lastPrice.created_at) : "—"}
          foot={lastPrice ? "ثبت‌شده در تاریخچهٔ این شعبه" : "هنوز تغییری تأیید نشده است"}
        />
      </section>
      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>شروع سریع</h3>
              <p>قدم بعدی را برای آماده‌سازی فهرست قیمت انتخاب کنید.</p>
            </div>
          </div>
          <div className="panel-body">
            <div className="quick-grid">
              <Quick
                icon="box"
                title="ورود کالاها"
                text="فایل CSV یا Excel"
                action={() => onSection("products")}
              />
              <Quick
                icon="users"
                title="ثبت تأمین‌کننده"
                text="نام و یادداشت اختیاری"
                action={() => onSection("suppliers")}
              />
              <Quick
                icon="upload"
                title="بارگذاری قیمت‌نامه"
                text="نگاشت ستون‌ها و پیش‌نمایش"
                action={() => onSection("imports")}
              />
              <Quick
                icon="file"
                title="بازبینی قیمت‌ها"
                text="تأیید صریح پیش از اعمال"
                action={() => {
                  if (pending[0]) onSelectPriceList(pending[0].id);
                  onSection("review");
                }}
              />
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>فعالیت اخیر</h3>
              <p>رویدادهای ثبت‌شده در این شعبه</p>
            </div>
            <button className="text-link" onClick={() => onSection("history")} type="button">
              مشاهدهٔ تاریخچه <Icon name="chevron" size={13} />
            </button>
          </div>
          <div className="panel-body">
            {history.length ? (
              <div className="activity-list">
                {history.slice(0, 4).map((item) => (
                  <Activity key={item.id} event={item} />
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ minHeight: 130 }}>
                <div>
                  <div className="empty-icon">
                    <Icon name="clock" />
                  </div>
                  <h3>هنوز فعالیتی ثبت نشده</h3>
                  <p>با واردکردن کالا یا قیمت‌نامه، تاریخچهٔ این شعبه شکل می‌گیرد.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  foot,
}: {
  icon: string;
  label: string;
  value: string;
  foot: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-icon">
          <Icon name={icon} size={17} />
        </span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">{foot}</div>
    </article>
  );
}

function Quick({
  icon,
  title,
  text,
  action,
}: {
  icon: string;
  title: string;
  text: string;
  action: () => void;
}) {
  return (
    <button className="quick-action" onClick={action} type="button">
      <span className="quick-action-icon">
        <Icon name={icon} />
      </span>
      <span>
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
    </button>
  );
}

function Activity({ event }: { event: HistoryEvent }) {
  const names: Record<string, string> = {
    "product.purchase_price_approved": "قیمت خرید کالا تأیید شد",
    "price_list.imported": "قیمت‌نامه وارد شد",
    "price_list.exported": "خروجی قیمت‌نامه دریافت شد",
    "product.created": "کالا ثبت شد",
    "products.imported": "فهرست کالاها وارد شد",
    "supplier.created": "تأمین‌کننده ثبت شد",
    "business.created": "کسب‌وکار ساخته شد",
    "price_list.row_reviewed": "ردیف قیمت‌نامه بازبینی شد",
    "price_list.cancelled": "قیمت‌نامه لغو شد",
  };
  return (
    <div className="activity-item">
      <i className="activity-dot" />
      <div>
        <strong>{names[event.event_type] ?? "فعالیت ثبت‌شده"}</strong>
        <span>{dateFa(event.created_at, "long")}</span>
      </div>
    </div>
  );
}
