import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/vazirmatn/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "بهابان | مدیریت قیمت خرید",
  description: "ورود، بازبینی و تأیید قیمت‌نامهٔ تأمین‌کنندگان برای کسب‌وکار شما",
  applicationName: "بهابان",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b3b3e" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
