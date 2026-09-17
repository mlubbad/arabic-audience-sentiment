import { useRef, useState, type ReactNode } from "react";
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
  // An anchor clicked while the sheet is open: the browser's native hash-jump
  // fires, but Radix's own close-focus lands right after it — `DialogContent`'s
  // default `onCloseAutoFocus` focuses the trigger without `preventScroll`,
  // which scrolls the page straight back to the header. So the jump has to
  // happen *after* that focus restoration, not race it: stash the target
  // here, cancel Radix's default autofocus in `onCloseAutoFocus` below, and
  // do the native fragment navigation there instead, once nothing is left to
  // undo it.
  const pending = useRef<string | null>(null);
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
          // Same-page only — the three anchors this page itself owns
          // (#why/#experience/#questions) are always written bare, so this
          // is enough without resolving a full URL. A cross-page anchor
          // (PricingPage's and LegalPage's own FAQ link, `${home}#questions`)
          // unloads this page regardless of the sheet, so it keeps the plain
          // `<a>` behaviour whether the sheet is open or not — intercepting
          // it here once cost a real regression: `location.hash` was being
          // set on the *current* page's URL instead of navigating home.
          if (open && l.href.startsWith("#")) {
            e.preventDefault();
            pending.current = l.href;
          }
          // Closed already (the desktop nav, never inside the sheet): the
          // browser's own hash-navigation does what it always did.
          setOpen(false);
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
            onCloseAutoFocus={(e) => {
              const h = pending.current;
              if (h) {
                pending.current = null;
                e.preventDefault();
                location.hash = h;
              }
            }}
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
