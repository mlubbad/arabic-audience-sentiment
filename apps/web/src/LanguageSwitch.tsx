/**
 * The one control that changes the interface language.
 *
 * It names the other language, in that language — "English" to an Arabic
 * reader, "العربية" to an English one — because a reader who cannot read the
 * current language needs the button to be legible to them, not to us. The
 * button carries its own `lang` so a screen reader pronounces the word in the
 * language it is written in, and a stable accessible name so a test can find
 * it in either state.
 */
import { otherLocale, setLocale, useLocale } from "./locale";
import { loadStrings, useStrings } from "./strings";

export function LanguageSwitch() {
  const locale = useLocale();
  const S = useStrings();
  const other = otherLocale(locale);
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
