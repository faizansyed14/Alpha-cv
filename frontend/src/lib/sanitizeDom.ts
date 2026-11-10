/**
 * Makes the HTML that was built from an UPLOADED document (a CV or a job description from a stranger) safe to show in the page.
 *
 * The preview turns a .docx into HTML with mammoth / docx-preview and puts it in the page. That HTML carries whatever the author of the
 * file wrote: a link whose address is `javascript:...` would run in the recruiter's session when clicked, and the session token is in
 * the browser's storage. So before it is shown: scripts, frames, objects and forms are removed, every `on...` attribute is removed,
 * and a link or image address is kept only if it is http(s), mailto, tel, an in-page anchor, a blob made by the preview itself, or a
 * plain raster image data address. Links open in a new tab without access to this page.
 */

const REMOVED_TAGS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea',
  'select', 'template', 'noscript', 'audio', 'video', 'source', 'track', 'foreignobject', 'portal',
]);

const URL_ATTRIBUTES = ['href', 'xlink:href', 'src', 'srcset', 'action', 'formaction', 'poster', 'data', 'background', 'cite', 'longdesc', 'ping'];

const SAFE_URL = /^(?:https?:|mailto:|tel:|#|blob:|data:image\/(?:png|jpe?g|gif|webp|bmp);)/i;

function isSafeUrl(value: string): boolean {
  // browsers ignore tabs, newlines and other control characters inside a scheme ("java\tscript:"), so they are removed before looking
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000- \u007f-\u009f]+/g, '');
  if (flat === '') return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(flat)) return SAFE_URL.test(flat);
  return true;                              // no scheme: a relative address or an in-page anchor
}

export function sanitizeDom(root: ParentNode, options: { allowStyle?: boolean } = {}): void {
  const elements = Array.from(root.querySelectorAll('*'));
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (REMOVED_TAGS.has(tag) || (tag === 'style' && !options.allowStyle)) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') {
        el.removeAttribute(attr.name);
      } else if (URL_ATTRIBUTES.includes(name)) {
        const parts = name === 'srcset' ? attr.value.split(',').map((p) => p.trim().split(/\s+/)[0]) : [attr.value];
        if (!parts.every(isSafeUrl)) el.removeAttribute(attr.name);
      }
    }
    if (tag === 'a') {
      el.setAttribute('rel', 'noopener noreferrer');
      el.setAttribute('target', '_blank');
    }
  }
}

/** HTML text from an untrusted document, cleaned: parsed into an inert document first, so nothing in it runs while it is being cleaned. */
export function sanitizeHtml(html: string, options: { allowStyle?: boolean } = {}): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  sanitizeDom(doc.body, options);
  return doc.body.innerHTML;
}
