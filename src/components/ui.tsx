"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconBell,
  IconBuildingStore,
  IconCategory2,
  IconChartLine,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconClock,
  IconDownload,
  IconFileText,
  IconGitBranch,
  IconLayoutDashboard,
  IconLogout,
  IconMenu2,
  IconMoon,
  IconPackage,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconSun,
  IconUpload,
  IconUserCircle,
  IconUsers,
  IconX,
} from "@tabler/icons-react";

const icons = {
  grid: IconLayoutDashboard,
  box: IconPackage,
  categories: IconCategory2,
  users: IconUsers,
  file: IconFileText,
  clock: IconClock,
  settings: IconSettings,
  plus: IconPlus,
  upload: IconUpload,
  chevron: IconChevronLeft,
  down: IconChevronDown,
  search: IconSearch,
  download: IconDownload,
  logout: IconLogout,
  close: IconX,
  menu: IconMenu2,
  check: IconCheck,
  warning: IconAlertTriangle,
  chart: IconChartLine,
  store: IconBuildingStore,
  branch: IconGitBranch,
  shield: IconShieldCheck,
  arrow: IconArrowUpRight,
  spark: IconSparkles,
  sun: IconSun,
  moon: IconMoon,
  bell: IconBell,
  user: IconUserCircle,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const IconComponent = icons[name as keyof typeof icons] ?? IconSparkles;
  return <IconComponent className="ui-icon" aria-hidden="true" size={size} stroke={1.8} />;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = 560,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => [
      ...(dialog?.querySelectorAll<HTMLElement>(
        "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])",
      ) ?? []),
    ];
    (
      dialog?.querySelector<HTMLElement>(
        "input:not([disabled]),select:not([disabled]),textarea:not([disabled])",
      ) ?? focusable()[0]
    )?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <dialog
        ref={dialogRef}
        className="modal"
        style={{ maxWidth: width }}
        open
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="بستن پنجره">
            <Icon name="close" size={17} />
          </button>
        </div>
        {children}
      </dialog>
    </div>
  );
}

export function Spinner({ label = "در حال بارگذاری" }: { label?: string }) {
  return (
    <output className="inline-loader">
      <i className="spinner" aria-hidden="true" />
      {label}
    </output>
  );
}

export function PaginationBar({
  page,
  size,
  total,
  onPageChange,
  onSizeChange,
  pageSizes = [10, 25, 50, 100],
}: {
  page: number;
  size: number;
  total: number;
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
  pageSizes?: number[];
}) {
  if (total <= 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const from = (currentPage - 1) * size + 1;
  const to = Math.min(currentPage * size, total);
  const number = (value: number) => new Intl.NumberFormat("fa-IR").format(value);
  const availableSizes = [...new Set([...pageSizes, size])].sort((left, right) => left - right);
  return (
    <nav className="pagination-bar" aria-label="صفحه‌بندی فهرست">
      <span className="pagination-range">
        نمایش {number(from)} تا {number(to)} از {number(total)}
      </span>
      <label className="pagination-size">
        <span>تعداد در صفحه</span>
        <select
          aria-label="تعداد آیتم در هر صفحه"
          value={size}
          onChange={(event) => onSizeChange(Number(event.target.value))}
        >
          {availableSizes.map((value) => (
            <option value={value} key={value}>
              {number(value)}
            </option>
          ))}
        </select>
      </label>
      <div className="pagination-controls">
        <button
          className="btn btn-ghost btn-small"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          type="button"
          aria-label="صفحهٔ قبلی"
        >
          قبلی
        </button>
        <span aria-live="polite">
          {number(currentPage)} از {number(pageCount)}
        </span>
        <button
          className="btn btn-ghost btn-small"
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(currentPage + 1)}
          type="button"
          aria-label="صفحهٔ بعدی"
        >
          بعدی
        </button>
      </div>
    </nav>
  );
}

export function Toast({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <div className={`toast${error ? " error" : ""}`} role={error ? "alert" : "status"}>
      <Icon name={error ? "warning" : "check"} size={16} />
      {message}
    </div>
  );
}
