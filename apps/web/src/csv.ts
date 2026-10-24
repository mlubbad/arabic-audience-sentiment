/**
 * Shared CSV cell escaping and browser file download helpers.
 *
 * Formulas (`=`, `+`, `-`, `@`, leading tab or CR) are neutralised with a
 * leading apostrophe so spreadsheet applications never evaluate untrusted
 * channel titles or handles as formulas, while numeric values stay unquoted
 * numbers and `null`/`undefined` stay empty cells (never `0`).
 */

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function downloadText(
  filename: string,
  text: string,
  type = "text/csv;charset=utf-8",
): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
