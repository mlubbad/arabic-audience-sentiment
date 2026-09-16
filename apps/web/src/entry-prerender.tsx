/**
 * The server-side entry the prerender script renders the public pages with.
 *
 * Built by `scripts/prerender.mjs` as a Vite SSR bundle after the client
 * build, then called once per public address. It mounts the same route
 * table the browser mounts (`publicRoutes.tsx`) under a `StaticRouter`,
 * with the pricing and legal pages imported eagerly — a lazy page inside
 * `renderToString` renders its fallback — and with the plan catalogue the
 * script fetched already in the query cache, so the pricing page renders its
 * cards rather than "reading the plans…".
 *
 * The strings for the address's language are loaded and the locale store
 * set before rendering, exactly as `main.tsx` does before hydrating: the two
 * renders must agree on every byte, and the language is the first thing
 * they could disagree on.
 *
 * Nothing here runs in the browser. The client bundle never imports it.
 */
import { Suspense } from "react";
import { renderToString } from "react-dom/server";
import { Routes, StaticRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DirectionProvider } from "@radix-ui/react-direction";
import type { Plan } from "@sentiment/contracts";
import { Landing } from "./Landing";
import { Pricing } from "./PricingPage";
import { LegalPage } from "./LegalPage";
import { ToastHost } from "./ui/Toast";
import { publicRoutes } from "./publicRoutes";
import { direction, setLocale } from "./locale";
import { loadStrings } from "./strings";
import { resolvePublicPath } from "./publicPaths";

export { PUBLIC_ROUTES, resolvePublicPath } from "./publicPaths";
export { SITE_PUBLIC, SITE_URL } from "./site";
export { EMBEDDED_CATALOGUE_ID, readCatalogue } from "./planCatalogue";
export { fixtureCatalogue } from "./data";

/** The hoistable head elements React 19 emits ahead of the markup —
 *  `<title>`, `<meta>` and `<link>` — as one run at the start of the string.
 *  Nothing else is emitted before the root element. */
const HEAD = /^(?:<title>.*?<\/title>|<meta\s[^>]*>|<link\s[^>]*>)*/s;

export async function render(
  path: string,
  catalogue: readonly Plan[],
): Promise<{ head: string; html: string; locale: "ar" | "en" }> {
  const hit = resolvePublicPath(path);
  if (!hit) throw new Error(`not a public page: ${path}`);
  await loadStrings(hit.locale);
  setLocale(hit.locale);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["catalogue"], catalogue);
  const out = renderToString(
    <QueryClientProvider client={client}>
      <DirectionProvider dir={direction(hit.locale)}>
        <StaticRouter location={path}>
          <Routes>
            {/* The same boundary main.tsx wraps a page loaded on demand in.
                Nothing suspends here — every page is imported eagerly — but
                the boundary leaves its markers in the HTML, and those are
                what let the client hydrate the page once its chunk arrives
                rather than discarding the markup for want of a boundary. */}
            {publicRoutes({ Landing, Pricing, LegalPage }, (element) => (
              <Suspense fallback={null}>{element}</Suspense>
            ))}
          </Routes>
        </StaticRouter>
        {/* Beside the router, as main.tsx mounts it: the hydrated tree must
            have the same shape down to this sibling, or React discards the
            markup and renders the page a second time. */}
        <ToastHost />
      </DirectionProvider>
    </QueryClientProvider>,
  );
  const head = HEAD.exec(out)?.[0] ?? "";
  return { head, html: out.slice(head.length), locale: hit.locale };
}
