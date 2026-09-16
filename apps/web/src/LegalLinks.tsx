/** The legal pages, as links — one list, read by every footer.
 *
 * The landing, the pricing page, the app shell and the legal pages themselves
 * each have a footer, and each used to be the place a link could be missing
 * from. One component, one order, one label set; a page that adds a footer
 * mounts this and has the same links as the rest.
 */
import { Link } from "react-router";
import { LEGAL_PATHS } from "./legal/types";
import { useStrings } from "./strings";

export function LegalLinks({ className }: { className?: string }) {
  const S = useStrings();
  return (
    <nav className={className} aria-label={S.legalNavLabel}>
      <Link to={LEGAL_PATHS.privacy}>{S.legalPrivacy}</Link>
      <Link to={LEGAL_PATHS.terms}>{S.legalTerms}</Link>
    </nav>
  );
}
