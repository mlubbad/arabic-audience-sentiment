/**
 * The public routes, built once for both renderers.
 *
 * `main.tsx` mounts them in the browser with the pricing and legal pages
 * loaded on demand; `entry-prerender.tsx` mounts the same table on the
 * server with every page in hand, because a lazy page inside
 * `renderToString` renders its fallback and the static HTML would carry an
 * empty pricing page. The table itself — which address, which page, which
 * language — is `PUBLIC_ROUTES`, so the two renderers cannot disagree about
 * what `/en/pricing` is.
 */
import type { ComponentType, ReactElement, ReactNode } from "react";
import { Route } from "react-router";
import type { Locale } from "./locale";
import type { LegalKey } from "./legal/types";
import { PUBLIC_ROUTES } from "./publicPaths";

export type PublicPages = {
  Landing: ComponentType<{ locale: Locale }>;
  Pricing: ComponentType<{ locale: Locale }>;
  LegalPage: ComponentType<{ doc: LegalKey; locale: Locale }>;
};

export function publicRoutes(
  { Landing, Pricing, LegalPage }: PublicPages,
  /** What a page that loads on demand is wrapped in — a Suspense boundary
   *  in the browser, nothing on the server. */
  wrap: (element: ReactElement) => ReactNode = (element) => element,
) {
  return PUBLIC_ROUTES.map(({ page, locale, path }) => {
    const element =
      page === "home" ? (
        <Landing locale={locale} />
      ) : page === "pricing" ? (
        wrap(<Pricing locale={locale} />)
      ) : (
        wrap(<LegalPage doc={page} locale={locale} />)
      );
    return <Route key={path} path={path} element={element} />;
  });
}
