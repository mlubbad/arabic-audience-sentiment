/**
 * One page of an in-memory list, decided away from the component.
 *
 * The videos section renders every video the filters admit. A channel with
 * 194 of them was a wall of cards; the fixture's five looked fine, which is
 * how the wall shipped. The list is already in memory — the snapshot builds
 * it from the filtered rows — so paging is a slice, not a request, and the
 * comments pager's cursors do not apply.
 *
 * The page index is clamped rather than trusted: a filter change can shrink
 * the list under a reader who sat on page four, and the answer to that is the
 * last page that still exists, never an empty one. `from`/`to` are 1-based for
 * the sentence "عرض 26–50 من 194"; both are 0 for an empty list, so the
 * sentence cannot claim to be showing item one of nothing.
 */
export type PageSlice<T> = {
  items: T[];
  /** 0-based, after clamping. */
  page: number;
  /** At least 1: an empty list is one empty page. */
  pages: number;
  /** 1-based position of the first item on the page; 0 when empty. */
  from: number;
  /** 1-based position of the last item on the page; 0 when empty. */
  to: number;
};

export function pageSlice<T>(
  all: T[],
  page: number,
  size: number,
): PageSlice<T> {
  const pages = Math.max(1, Math.ceil(all.length / size));
  const clamped = Math.min(Math.max(page, 0), pages - 1);
  const start = clamped * size;
  const items = all.slice(start, start + size);
  return {
    items,
    page: clamped,
    pages,
    from: items.length ? start + 1 : 0,
    to: start + items.length,
  };
}
