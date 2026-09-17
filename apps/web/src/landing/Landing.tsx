import "./landing.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { publicPath } from "../publicPaths";
import { homeSeo } from "../seo";
import { PageHead, usePublicLocale } from "../PageHead";
import { PublicShell } from "../public/PublicShell";
import { Hero } from "./Hero";
import { Why } from "./Why";
import { Demo } from "./Demo";
import { Benefits } from "./Benefits";
import { Audience } from "./Audience";
import { Trust } from "./Trust";
import { Faq } from "./Faq";
import { Closing } from "./Closing";

/** `locale` comes from the route — `/` is Arabic and `/en` is English — not
 *  from the stored preference; see `publicPaths.ts`. */
export function Landing({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  // The language on the document and in the store, for as long as this
  // page is mounted — the shell does the same for itself.
  usePublicLocale(locale);
  return (
    <PublicShell
      locale={locale}
      page="home"
      mainId="landing-content"
      mainClassName="lp-main"
      links={[
        { href: "#why", label: S.lpNavWhy, kind: "anchor" },
        { href: "#experience", label: S.lpNavExperience, kind: "anchor" },
        { href: "#questions", label: S.lpNavFaq, kind: "anchor" },
        {
          href: publicPath("pricing", locale),
          label: S.pricingTitle,
          kind: "route",
        },
      ]}
    >
      <PageHead seo={homeSeo(locale, S)} />
      <Hero locale={locale} />
      <Why locale={locale} />
      <Demo locale={locale} />
      <Benefits locale={locale} />
      <Audience locale={locale} />
      <Trust locale={locale} />
      <Faq locale={locale} />
      <Closing locale={locale} />
    </PublicShell>
  );
}
