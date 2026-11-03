/**
 * Experience as it should read on a job: "8 years", "5-8 years", "1 year".
 *
 * Postings store this as free text ("8 years", "3-5", "8+"), a number, or nothing. The unit is added only when the
 * value does not already carry one, so it never reads "8 years yrs experience". Returns null when there is nothing
 * to show (empty, "0", "not specified").
 */
export function formatExperience(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || /^(0+(\.0+)?|n\/?a|not specified|none|-+)$/i.test(text)) return null;

  const hasUnit = /\b(years?|yrs?)\b/i.test(text);
  if (hasUnit) {
    // Normalise "yrs" / "yr" to "years" and drop a trailing "experience" the posting may have carried.
    return text
      .replace(/\b(yrs?|years?)\b\.?/i, (m) => (/^1$/.test(text.replace(/\D/g, '')) && !/[-+]/.test(text) ? 'year' : 'years'))
      .replace(/\s*experience\s*$/i, '')
      .trim();
  }
  const numeric = Number(text.replace(/\+$/, ''));
  if (!Number.isNaN(numeric) && !/[-]/.test(text)) return `${text} ${numeric === 1 ? 'year' : 'years'}`;
  return `${text} years`;
}
