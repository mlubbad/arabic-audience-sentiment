/** The legal pages, as links — one list, read by every footer.
 *
 * The landing, the pricing page, the app shell and the legal pages themselves
 * each have a footer, and each used to be the place a link could be missing
 * from. One component, one order, one label set; a page that adds a footer
 * mounts this and has the same links as the rest.
 */
import { Link } from "react-router";
import { useLocale, type Locale } from "./locale";
import { publicPath } from "./publicPaths";
import { useStrings } from "./strings";

export function LegalLinks({
  className,
  locale: given,
}: {
  className?: string;
  /** A public page passes the locale its address names; the shell's footer
   *  reads the stored preference. Either way the link goes to the document
   *  in the language the reader is reading. */
  locale?: Locale;
}) {
  const stored = useLocale();
  const locale = given ?? stored;
  const S = useStrings(locale);
  return (
    <nav className={className} aria-label={S.legalNavLabel}>
      <Link to={publicPath("privacy", locale)}>{S.legalPrivacy}</Link>
      <Link to={publicPath("terms", locale)}>{S.legalTerms}</Link>
    </nav>
  );
}
