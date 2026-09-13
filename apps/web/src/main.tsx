import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink, Outlet } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./style.css";
import { Landing } from "./Landing";
const Dashboard = lazy(() =>
  import("./Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Connected = lazy(() =>
  import("./Connected").then((m) => ({ default: m.Connected })),
);
const Account = lazy(() =>
  import("./Account").then((m) => ({ default: m.Account })),
);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
function AppLayout() {
  return (
    <>
      <a className="skip" href="#content">
        انتقل إلى المحتوى
      </a>
      <header>
        <p>تحليل مشاعر الجمهور</p>
        <nav aria-label="التنقل الرئيسي">
          <NavLink to="/">الرئيسية</NavLink>
          <NavLink to="/dashboard">لوحة الاختبار</NavLink>
          <NavLink to="/account">الحساب ومساحات العمل</NavLink>
        </nav>
      </header>
      <main id="content">
        <Suspense fallback={<p role="status">جارٍ فتح الصفحة…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/account" element={<Account />} />
            <Route path="/connected" element={<Connected />} />
            <Route path="*" element={<p>الصفحة غير موجودة</p>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
