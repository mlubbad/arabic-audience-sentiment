import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import "./public.css";
import { BrandMark } from "../BrandMark";
import { direction, otherLocale, type Locale } from "../locale";
import { useStrings } from "../strings";
import { LanguageSwitch } from "../LanguageSwitch";
import { LegalLinks } from "../LegalLinks";
import { publicPath, type PublicPage } from "../publicPaths";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../ui/Dialog";
import { cn } from "../ui/cn";

export type ShellLink = {
  href: string;
  label: string;
  /** `route` is a client-side navigation; `anchor` a plain hash link, which
   *  is the only kind that scrolls to a section of the page it is on. */
  kind: "route" | "anchor";
};

/** The chrome every public page shares — the announcement band, the header
 *  with its sheet menu on narrow screens, and the footer. The three pages
 *  used to copy this markup by hand and each import the whole landing
 *  stylesheet; now it is written once and the pages bring only their body. */
export function PublicShell({
  locale,
  page,
  links,
  mainId,
  mainClassName,
  pageClassName,
  children,
}: {
  locale: Locale;
  page: PublicPage;
  links: ShellLink[];
  mainId: string;
  mainClassName?: string;
  pageClassName?: string;
  children: ReactNode;
}) {
  const S = useStrings(locale);
  const [open, setOpen] = useState(false);
  const home = publicPath("home", locale);
  const pricing = publicPath("pricing", locale);
  const questions = page === "home" ? "#questions" : `${home}#questions`;
  const link = (l: ShellLink) =>
    l.kind === "route" ? (
      <Link key={l.href} to={l.href} onClick={() => setOpen(false)}>
        {l.label}
      </Link>
    ) : (
      <a
        key={l.href}
        href={l.href}
        onClick={(e) => {
          const wasOpen = open;
          setOpen(false);
          // An anchor on this same page: the browser's own hash-navigation
          // scroll would otherwise handle this, but from inside the sheet it
          // silently drops the scroll and nothing retries it — measured, not
          // guessed: closing the sheet (react-remove-scroll's cleanup plus
          // Radix's focus restoration) blocks a scrollIntoView attempted too
          // soon after, for about 250ms, with no DOM state to observe and
          // wait on in between. A target elsewhere (PricingPage's own FAQ
          // link points at the home page's `#questions`) isn't on this page
          // yet, so this leaves it to native navigation.
          const target = document.getElementById(l.href.slice(1));
          if (target) {
            e.preventDefault();
            history.pushState(null, "", l.href);
            if (wasOpen) setTimeout(() => target.scrollIntoView(), 300);
            else target.scrollIntoView();
          }
        }}
      >
        {l.label}
      </a>
    );
  return (
    <div className={cn("landing", pageClassName)} dir={direction(locale)}>
      <a className="lp-skip" href={`#${mainId}`}>
        {S.skipToContent}
      </a>
      <div className="lp-announcement">
        {S.announcementLead} <span>{S.announcementTag}</span>
        <LanguageSwitch
          locale={locale}
          to={publicPath(page, otherLocale(locale))}
        />
      </div>
      <header className="lp-header">
        <Link className="lp-brand" to={home} aria-label={S.brandHomeLabel}>
          <BrandMark /> {S.brand}
          <span className="lp-brand-dot">.</span>
        </Link>
        <nav id="landing-nav" className="lp-nav" aria-label={S.lpNavLabel}>
          {links.map(link)}
        </nav>
        <Button asChild variant="secondary" size="sm" className="lp-header-cta">
          <Link to="/account">
            {S.lpOpenAccount} <span aria-hidden="true">{S.arrowUpForward}</span>
          </Link>
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="lp-menu"
              aria-label={S.lpMenuLabel}
            >
              {open ? S.menuClose : S.menuOpen}
            </Button>
          </DialogTrigger>
          <DialogContent
            variant="sheet"
            closeLabel={S.menuClose}
            className="lp-sheet"
            aria-describedby={undefined}
          >
            <DialogTitle className="lp-sheet-title">{S.lpNavLabel}</DialogTitle>
            <nav className="lp-sheet-nav" aria-label={S.lpNavLabel}>
              {links.map(link)}
              <Link to="/account" onClick={() => setOpen(false)}>
                {S.lpOpenAccount}
              </Link>
            </nav>
          </DialogContent>
        </Dialog>
      </header>
      <main id={mainId} className={mainClassName}>
        {children}
      </main>
      <footer className="lp-footer">
        <div>
          <Link className="lp-brand" to={home}>
            <BrandMark /> {S.brand}.
          </Link>
          <p>{S.lpFooterTagline}</p>
        </div>
        <nav aria-label={S.lpFooterNavLabel}>
          <Link to={pricing}>{S.pricingTitle}</Link>
          <Link to="/dashboard">{S.lpFooterDashboard}</Link>
          <Link to="/account">{S.lpFooterAccount}</Link>
          <a href={questions}>{S.lpNavFaq}</a>
        </nav>
        {/* Where a reviewer at Google or Paddle looks for them, and where a
            visitor expects them: the foot of the page, by their own titles. */}
        <LegalLinks className="lp-legal" locale={locale} />
        <div className="lp-footer-bottom">
          <span>{S.lpFooterVersion}</span>
          <span>{S.lpFooterPreview}</span>
        </div>
      </footer>
    </div>
  );
}
