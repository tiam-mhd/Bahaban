"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { api, jsonBody } from "@/lib/client";
import { loadGlobalTheme, saveGlobalTheme } from "@/lib/appearance";
import { Icon } from "@/components/ui";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const idPrefix = useId();
  const phoneId = `${idPrefix}-phone`;
  const codeId = `${idPrefix}-code`;
  const errorId = `${idPrefix}-error`;
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(loadGlobalTheme());
  }, []);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds((left) => left - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api<{ developmentCode?: string }>(
        "/api/auth/otp/request",
        jsonBody({ phone }),
      );
      setStep("code");
      setSeconds(60);
      if (result.developmentCode) setCode(result.developmentCode);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "ارسال کد انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/auth/otp/verify", jsonBody({ phone, code }));
      onAuthenticated();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "کد ورود معتبر نیست.");
    } finally {
      setBusy(false);
    }
  }

  const resend = async () => {
    setError("");
    setBusy(true);
    try {
      const result = await api<{ developmentCode?: string }>(
        "/api/auth/otp/request",
        jsonBody({ phone }),
      );
      setSeconds(60);
      if (result.developmentCode) setCode(result.developmentCode);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "ارسال کد انجام نشد.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page" data-theme={theme}>
      <button
        className="icon-button auth-theme-toggle"
        type="button"
        aria-label={theme === "dark" ? "فعال‌کردن تم روشن" : "فعال‌کردن تم تاریک"}
        aria-pressed={theme === "dark"}
        title={theme === "dark" ? "تم روشن" : "تم تاریک"}
        onClick={() => {
          const next = theme === "dark" ? "light" : "dark";
          setTheme(next);
          saveGlobalTheme(next);
        }}
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
      </button>
      <aside className="auth-aside">
        <div className="brand">
          <span className="brand-mark icon-slot">
            <Icon name="chart" size={23} />
          </span>
          <div>
            <div className="brand-name">بهابان</div>
            <div className="brand-subtitle">مدیریت هوشمند قیمت خرید</div>
          </div>
        </div>
        <div>
          <div className="auth-art" aria-hidden="true">
            <div className="auth-art-card">
              <div className="auth-art-line">
                <span>ورود قیمت‌نامه</span>
                <span>۱</span>
              </div>
              <div className="auth-art-line">
                <span>بررسی و تطبیق</span>
                <span>۲</span>
              </div>
              <div className="auth-art-line">
                <span>تأیید تغییر قیمت</span>
                <span>۳</span>
              </div>
              <div className="auth-art-line">
                <span>دریافت خروجی</span>
                <Icon name="check" size={16} />
              </div>
            </div>
          </div>
          <h2>
            قیمت‌های جدید را
            <br />
            با اطمینان بررسی کنید.
          </h2>
          <p>
            قیمت‌نامه را وارد کنید، ردیف‌های نیازمند بررسی را ببینید و فقط پس از تأیید خودتان تغییرها
            را اعمال کنید.
          </p>
        </div>
        <footer>اطلاعات کسب‌وکار شما به شعبهٔ انتخاب‌شده محدود می‌ماند.</footer>
      </aside>
      <section className="auth-main">
        <div className="auth-card">
          <span className="pill pill-success">ورود امن با شمارهٔ موبایل</span>
          <h1>{step === "phone" ? "به بهابان خوش آمدید" : "کد ورود را وارد کنید"}</h1>
          <p>
            {step === "phone"
              ? "برای ورود یا ساخت حساب، شمارهٔ موبایل خود را بنویسید."
              : `کد یک‌بارمصرف برای ${phone} ارسال شد.`}
          </p>
          {step === "phone" ? (
            <form onSubmit={requestCode}>
              <div className="field">
                <label htmlFor={phoneId}>شمارهٔ موبایل</label>
                <input
                  id={phoneId}
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="۰۹۱۲۱۲۳۴۵۶۷"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  required
                  aria-describedby={error ? errorId : undefined}
                />
                <span className="field-hint">شماره با ۰۹ یا پیش‌شمارهٔ ‎+۹۸ پذیرفته می‌شود.</span>
              </div>
              {error && (
                <p id={errorId} className="error-text" role="alert">
                  {error}
                </p>
              )}
              <button className="btn btn-primary" disabled={busy} type="submit">
                {busy ? (
                  <>
                    <i className="spinner" /> در حال ارسال
                  </>
                ) : (
                  <>
                    دریافت کد ورود <Icon name="chevron" size={15} />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode}>
              <div className="field">
                <label htmlFor={codeId}>کد یک‌بارمصرف</label>
                <input
                  id={codeId}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  maxLength={8}
                  placeholder="کد پیامک‌شده"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                  aria-describedby={error ? errorId : undefined}
                />
                <span className="field-hint">
                  کد تا ۵ دقیقه اعتبار دارد و فقط یک‌بار پذیرفته می‌شود. در محیط توسعه، کد آزمایشی در
                  همین صفحه نشان داده می‌شود.
                </span>
              </div>
              {error && (
                <p id={errorId} className="error-text" role="alert">
                  {error}
                </p>
              )}
              <button className="btn btn-primary" disabled={busy} type="submit">
                {busy ? (
                  <>
                    <i className="spinner" /> در حال بررسی
                  </>
                ) : (
                  "ورود به حساب"
                )}
              </button>
              <div className="toolbar" style={{ marginTop: 13, marginBottom: 0 }}>
                <button
                  className="text-link"
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setCode("");
                    setError("");
                  }}
                >
                  ویرایش شماره
                </button>
                <button
                  className="text-link"
                  type="button"
                  onClick={resend}
                  disabled={busy || seconds > 0}
                >
                  {seconds > 0
                    ? `ارسال دوباره تا ${new Intl.NumberFormat("fa-IR").format(seconds)} ثانیه`
                    : "ارسال دوبارهٔ کد"}
                </button>
              </div>
            </form>
          )}
          <div className="auth-footer">
            با ادامه، استفاده از بهابان تابع شرایط استفاده و حریم خصوصی است.
          </div>
        </div>
      </section>
    </main>
  );
}
