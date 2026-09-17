import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";

/**
 * A `ui/Select` with a visible `<label>` pointing at its trigger by `id`,
 * and the same text repeated as `aria-label` on the trigger itself — the
 * old plain `<select aria-label>` carried both, so `getByLabelText` in the
 * browser suite resolves the control either way while migration is in
 * flight. One place to change if the pairing ever needs to.
 *
 * `labelHidden` keeps the `<label>` in the DOM but takes it off screen
 * (`ui-sr-only`): the pinned bar pays for every row, and a trigger already
 * reading «كل الفيديوهات» names its own field. The `aria-label` on the
 * trigger stays either way, so the control resolves by label as before.
 */
export function Labelled({
  id,
  label,
  labelHidden = false,
  value,
  onValueChange,
  children,
}: {
  id: string;
  label: string;
  labelHidden?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="db-field">
      <label htmlFor={id} className={labelHidden ? "ui-sr-only" : undefined}>
        {label}
      </label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}
