/**
 * Returns a same-origin relative path safe to pass to router.push, or null.
 *
 * Rejects protocol-relative ("//host"), backslash-tricked ("/\\host"),
 * scheme-bearing ("/javascript:..."), and control-character payloads that a
 * browser could normalize into an absolute, cross-origin URL.
 */
export function safeRedirectPath(raw: string | string[] | null | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v == null || typeof v !== 'string') return null;
  const t = v.trim();

  // Must be a relative path.
  if (!t.startsWith('/')) return null;
  // Reject any control characters (CR/LF/tab/null/etc.).
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(t)) return null;
  // Reject backslashes (browsers treat "\" like "/" in URLs).
  if (t.includes('\\')) return null;
  // Reject protocol-relative ("//evil.com") — the 2nd char must not be "/".
  if (t.length >= 2 && t[1] === '/') return null;
  // Defense in depth: never allow an embedded scheme in the first segment.
  if (/^\/[^/]*:/.test(t)) return null;

  // Final guard: resolve against a dummy origin; it must stay same-origin.
  try {
    const base = 'http://localhost';
    const resolved = new URL(t, base);
    if (resolved.origin !== base) return null;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return null;
  }
}
