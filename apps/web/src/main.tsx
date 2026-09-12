import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./Dashboard";
import { Account } from "./Account";
import "./style.css";
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <a className="skip" href="#content">
          انتقل إلى المحتوى
        </a>
        <header>
          <p>تحليل مشاعر الجمهور</p>
          <nav aria-label="التنقل الرئيسي">
            <NavLink to="/">لوحة الاختبار</NavLink>
            <NavLink to="/account">الحساب ومساحات العمل</NavLink>
          </nav>
        </header>
        <main id="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/account" element={<Account />} />
            <Route path="*" element={<p>الصفحة غير موجودة</p>} />
          </Routes>
        </main>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
