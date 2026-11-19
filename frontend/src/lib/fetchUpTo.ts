/**
 * Fetch the first `count` rows of a paged list again, in pages of at most `maxPage` (the server's limit), so a refresh keeps every row
 * the reader has already scrolled to instead of cutting the list back to its first page. Returns the first page's answer (its totals and
 * counts are the list's) with all the rows. A page shorter than asked for is the end of the list (rows deleted meanwhile).
 */
export async function fetchUpTo<R extends { items: unknown[] }>(
  count: number,
  minPage: number,
  maxPage: number,
  page: (limit: number, offset: number) => Promise<R>,
): Promise<{ first: R; items: R['items'] }> {
  const want = Math.max(minPage, count);
  let asked = Math.min(want, maxPage);
  const first = await page(asked, 0);
  const items: R['items'] = [...first.items];
  let last = first.items.length;
  while (items.length < want && last === asked) {
    asked = Math.min(want - items.length, maxPage);
    const next = await page(asked, items.length);
    items.push(...next.items);
    last = next.items.length;
  }
  return { first, items };
}
