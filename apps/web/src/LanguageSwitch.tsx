/**
 * The one control that changes the interface language.
 *
 * It names the other language, in that language — "English" to an Arabic
 * reader, "العربية" to an English one — because a reader who cannot read the
 * current language needs the button to be legible to them, not to us. The
 * control carries its own `lang` so a screen reader pronounces the word in
 * the language it is written in, and a stable accessible name so a test can
 * find it in either state.
 *
 * On a public page it is a link, not a button: the other language is another
 * address (`publicPaths.ts`), and a link is what a crawler follows to find
 * the English page and what a reader can open in a new tab. The click still
 * fetches the other language's strings before it moves, so the destination
 * never paints one language's words under the other's `lang`; a modified
 * click (new tab, new window) is left to the browser.
 */
import { Link, useNavigate } from "react-router";
import { otherLocale, setLocale, useLocale, type Locale } from "./locale";
import { loadStrings, useStrings } from "./strings";

export function LanguageSwitch({
  locale: given,
  to,
}: {
  /** The page's own locale, when its address decides it. */
  locale?: Locale;
  /** The same page in the other language. */
  to?: string;
}) {
  const stored = useLocale();
  const locale = given ?? stored;
  const S = useStrings(locale);
  const other = otherLocale(locale);
  const navigate = useNavigate();
  if (to !== undefined)
    return (
      <Link
        className="app-lang"
        to={to}
        hrefLang={other}
        lang={other}
        aria-label={S.switchLabel}
        data-testid="language-switch"
        onClick={(event) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          void loadStrings(other).then(() => {
            setLocale(other);
            void navigate(to);
          });
        }}
      >
        {S.switchToOther}
      </Link>
    );
  return (
    <button
      type="button"
      className="app-lang"
      lang={other}
      aria-label={S.switchLabel}
      data-testid="language-switch"
      // The other language's strings arrive before the locale flips, so the
      // page never renders one language's words under the other's `lang`.
      onClick={() => void loadStrings(other).then(() => setLocale(other))}
    >
      {S.switchToOther}
    </button>
  );
}
