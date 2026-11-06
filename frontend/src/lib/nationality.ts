import { COUNTRIES } from '@/lib/countries';

// "Nationality: Indian" on a CV is a demonym, the form's picker wants the country. Only certain matches are returned.
const DEMONYMS: Record<string, string> = {
  afghan: 'Afghanistan', algerian: 'Algeria', american: 'United States', argentine: 'Argentina', argentinian: 'Argentina',
  australian: 'Australia', austrian: 'Austria', bahraini: 'Bahrain', bangladeshi: 'Bangladesh', belgian: 'Belgium',
  brazilian: 'Brazil', british: 'United Kingdom', canadian: 'Canada', chinese: 'China', colombian: 'Colombia',
  czech: 'Czechia', danish: 'Denmark', dutch: 'Netherlands', egyptian: 'Egypt', emirati: 'United Arab Emirates',
  ethiopian: 'Ethiopia', filipino: 'Philippines', finnish: 'Finland', french: 'France', german: 'Germany',
  ghanaian: 'Ghana', greek: 'Greece', indian: 'India', indonesian: 'Indonesia', iranian: 'Iran', iraqi: 'Iraq',
  irish: 'Ireland', italian: 'Italy', japanese: 'Japan', jordanian: 'Jordan', kenyan: 'Kenya', kuwaiti: 'Kuwait',
  lebanese: 'Lebanon', libyan: 'Libya', malaysian: 'Malaysia', mexican: 'Mexico', moroccan: 'Morocco', nepalese: 'Nepal',
  nepali: 'Nepal', nigerian: 'Nigeria', norwegian: 'Norway', omani: 'Oman', pakistani: 'Pakistan',
  palestinian: 'Palestinian Territory', polish: 'Poland', portuguese: 'Portugal', qatari: 'Qatar', romanian: 'Romania',
  russian: 'Russia', saudi: 'Saudi Arabia', 'saudi arabian': 'Saudi Arabia', singaporean: 'Singapore',
  'south african': 'South Africa', 'south korean': 'South Korea', korean: 'South Korea', spanish: 'Spain',
  'sri lankan': 'Sri Lanka', sudanese: 'Sudan', swedish: 'Sweden', swiss: 'Switzerland', syrian: 'Syria',
  tanzanian: 'Tanzania', thai: 'Thailand', tunisian: 'Tunisia', turkish: 'Turkey', ugandan: 'Uganda',
  ukrainian: 'Ukraine', 'united arab emirates': 'United Arab Emirates', uae: 'United Arab Emirates',
  uk: 'United Kingdom', usa: 'United States', us: 'United States', vietnamese: 'Vietnam', yemeni: 'Yemen',
  zimbabwean: 'Zimbabwe',
};

export function countryFromNationality(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!v) return null;
  const exact = COUNTRIES.find((c) => c.toLowerCase() === v);
  if (exact) return exact;
  const country = DEMONYMS[v];
  return country && COUNTRIES.includes(country) ? country : null;
}
