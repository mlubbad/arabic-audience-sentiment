/** A paragraph's runs: plain text and `[label](href)` links, in order. */
export type Run = string | { label: string; href: string };

const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function inline(text: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index > last) runs.push(text.slice(last, m.index));
    runs.push({ label: m[1], href: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push(text.slice(last));
  return runs;
}
