import { describe, it, expect } from 'vitest';
import { sanitizeDom, sanitizeHtml } from '@/lib/sanitizeDom';

describe('sanitizeHtml: a stranger\'s document shown in the page', () => {
  it('removes scripts, frames, objects, forms and event handlers', () => {
    const out = sanitizeHtml(
      '<p onclick="steal()">Hi</p><script>steal()</script><iframe src="https://evil.test"></iframe>' +
      '<object data="x"></object><form action="https://evil.test"><input name="p"></form><img src="https://ok.test/a.png" onerror="steal()">',
    );
    expect(out).not.toMatch(/script|iframe|object|<form|<input|onclick|onerror/i);
    expect(out).toContain('Hi');
    expect(out).toContain('https://ok.test/a.png');
  });

  it('drops javascript: and other dangerous addresses, however they are disguised', () => {
    for (const href of ['javascript:steal()', 'JaVaScRiPt:steal()', 'java\tscript:steal()', ' javascript:steal()', 'vbscript:x', 'data:text/html,<script>1</script>', 'data:image/svg+xml;base64,AAAA']) {
      const out = sanitizeHtml(`<a href="${href}">link</a>`);
      expect(out, href).not.toMatch(/href=/i);
      expect(out).toContain('link');
    }
  });

  it('keeps the links and images a CV legitimately has, and opens links in a new tab without access to the page', () => {
    const out = sanitizeHtml('<a href="https://www.linkedin.com/in/jane">LinkedIn</a> <a href="mailto:jane@x.com">mail</a> <a href="#top">top</a> <img src="data:image/png;base64,AAAA">');
    expect(out).toContain('href="https://www.linkedin.com/in/jane"');
    expect(out).toContain('href="mailto:jane@x.com"');
    expect(out).toContain('href="#top"');
    expect(out).toContain('src="data:image/png;base64,AAAA"');
    expect(out).toMatch(/rel="noopener noreferrer"/);
    expect(out).toMatch(/target="_blank"/);
  });

  it('cleans every address in a srcset, and keeps the style of a rendered document only when asked', () => {
    expect(sanitizeHtml('<img srcset="https://ok.test/a.png 1x, javascript:x 2x">')).not.toMatch(/srcset/);
    expect(sanitizeHtml('<style>p{color:red}</style><p>x</p>')).not.toMatch(/<style/);
    expect(sanitizeHtml('<style>p{color:red}</style><p>x</p>', { allowStyle: true })).toMatch(/<style/);
  });

  it('works on an element already in the page (what the docx renderer builds)', () => {
    const box = document.createElement('div');
    box.innerHTML = '<a href="javascript:steal()">x</a><span onmouseover="steal()">y</span><script>1</script>';
    sanitizeDom(box);
    expect(box.innerHTML).not.toMatch(/javascript|onmouseover|script/i);
    expect(box.textContent).toContain('x');
  });
});
