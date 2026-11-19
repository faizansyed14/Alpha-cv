import { describe, expect, it, vi } from 'vitest';
import { fetchUpTo } from './fetchUpTo';

/** A list of `n` rows served in pages, as the server does. */
function server(n: number) {
  const rows = Array.from({ length: n }, (_, i) => i);
  const page = vi.fn(async (limit: number, offset: number) => ({ items: rows.slice(offset, offset + limit), total: rows.length }));
  return { rows, page };
}

describe('refreshing as many rows as are on screen', () => {
  it('takes the first page when little is loaded', async () => {
    const { page } = server(100);
    const { items, first } = await fetchUpTo(5, 20, 100, page);
    expect(items).toHaveLength(20);
    expect(first.total).toBe(100);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('fetches every row the reader scrolled to, in pages within the server limit', async () => {
    const { page, rows } = server(500);
    const { items } = await fetchUpTo(230, 20, 100, page);
    expect(items).toEqual(rows.slice(0, 230));
    expect(page.mock.calls).toEqual([[100, 0], [100, 100], [30, 200]]);
  });

  it('stops when the list is shorter than what was on screen (rows were deleted meanwhile)', async () => {
    const { page } = server(150);
    const { items } = await fetchUpTo(230, 20, 100, page);
    expect(items).toHaveLength(150);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('handles an empty list', async () => {
    const { page } = server(0);
    const { items } = await fetchUpTo(40, 20, 100, page);
    expect(items).toEqual([]);
    expect(page).toHaveBeenCalledTimes(1);
  });
});
