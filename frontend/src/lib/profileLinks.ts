/**
 * LinkedIn and GitHub profile links. The server already returns only clean https links; this check runs again before one
 * becomes a clickable `href`, so a value that is anything else (a `javascript:` address, another site) is never opened.
 */
const HOSTS = { linkedin: /^(?:[a-z]{2,3}|www)\.linkedin\.com$|^linkedin\.com$/i, github: /^(?:www\.)?github\.com$/i };

export function safeProfileUrl(value: string | null | undefined, site: 'linkedin' | 'github'): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !HOSTS[site].test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Short text for a link chip: the part after the site name (`jane-doe`). */
export function profileHandle(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || '');
  } catch {
    return '';
  }
}
