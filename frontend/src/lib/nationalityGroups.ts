/**
 * Nationality regions for the left filter of the database page: "Any Arab National" ticks every country of the region in one click.
 * A candidate's nationality is stored as the country name in English ("India", "United Arab Emirates"), as the CV extraction and the
 * careers form write it; older CVs may say the adjective ("Indian"). So a ticked country is searched under every name a CV may use
 * for it (see `nationalitySearchTerms`).
 */

export interface NationalityGroup {
  key: string;
  label: string;
  countries: string[];
}

const ARAB = [
  'Algeria', 'Bahrain', 'Comoros', 'Djibouti', 'Egypt', 'Iraq', 'Jordan', 'Kuwait', 'Lebanon', 'Libya', 'Mauritania', 'Morocco',
  'Oman', 'Palestinian Territory', 'Qatar', 'Saudi Arabia', 'Somalia', 'Sudan', 'Syria', 'Tunisia', 'United Arab Emirates', 'Yemen',
];

export const NATIONALITY_GROUPS: NationalityGroup[] = [
  { key: 'arab', label: 'Any Arab National', countries: ARAB },
  { key: 'gcc', label: 'Any GCC National', countries: ['Bahrain', 'Kuwait', 'Oman', 'Qatar', 'Saudi Arabia', 'United Arab Emirates'] },
  {
    key: 'european',
    label: 'Any European National',
    countries: [
      'Albania', 'Andorra', 'Austria', 'Belgium', 'Bosnia and Herzegovina', 'Bulgaria', 'Croatia', 'Cyprus', 'Czechia', 'Denmark',
      'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland', 'Italy', 'Kosovo', 'Latvia', 'Liechtenstein',
      'Lithuania', 'Luxembourg', 'Malta', 'Moldova', 'Monaco', 'Montenegro', 'North Macedonia', 'Norway', 'Poland', 'Portugal', 'Romania',
      'San Marino', 'Serbia', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'The Netherlands', 'Ukraine', 'United Kingdom',
    ],
  },
  { key: 'anglophone', label: 'Any Anglophone National', countries: ['Australia', 'Canada', 'Ireland', 'New Zealand', 'South Africa', 'United Kingdom', 'United States'] },
  {
    key: 'cis',
    label: 'Any CIS National',
    countries: ['Armenia', 'Azerbaijan', 'Belarus', 'Kazakhstan', 'Kyrgyzstan', 'Moldova', 'Russia', 'Tajikistan', 'Turkmenistan', 'Uzbekistan'],
  },
  { key: 'south_asian', label: 'Any South Asian National', countries: ['Afghanistan', 'Bangladesh', 'Bhutan', 'India', 'Maldives', 'Nepal', 'Pakistan', 'Sri Lanka'] },
  {
    key: 'south_east_asian',
    label: 'Any South-East Asian National',
    countries: ['Brunei', 'Cambodia', 'Indonesia', 'Laos', 'Malaysia', 'Myanmar', 'Philippines', 'Singapore', 'Thailand', 'Timor Leste', 'Vietnam'],
  },
];

/** The other names a CV (or an older record) may give a country: the adjective, a short form. Lower case, as words. */
const OTHER_NAMES: Record<string, string[]> = {
  Afghanistan: ['afghan'], Albania: ['albanian'], Algeria: ['algerian'], Andorra: ['andorran'], Armenia: ['armenian'], Australia: ['australian'],
  Austria: ['austrian'], Azerbaijan: ['azerbaijani'], Bahrain: ['bahraini'], Bangladesh: ['bangladeshi'], Belarus: ['belarusian'],
  Belgium: ['belgian'], Bhutan: ['bhutanese'], 'Bosnia and Herzegovina': ['bosnian', 'bosnia'], Brunei: ['bruneian'], Bulgaria: ['bulgarian'],
  Cambodia: ['cambodian'], Canada: ['canadian'], Comoros: ['comoran', 'comorian'], Croatia: ['croatian'], Cyprus: ['cypriot'],
  Czechia: ['czech', 'czech republic'], Denmark: ['danish'], Djibouti: ['djiboutian'], Egypt: ['egyptian'], Estonia: ['estonian'],
  Finland: ['finnish'], France: ['french'], Germany: ['german'], Greece: ['greek'], Hungary: ['hungarian'], Iceland: ['icelandic'],
  India: ['indian'], Indonesia: ['indonesian'], Iraq: ['iraqi'], Ireland: ['irish'], Italy: ['italian'], Jordan: ['jordanian'],
  Kazakhstan: ['kazakh', 'kazakhstani'], Kosovo: ['kosovan', 'kosovar'], Kuwait: ['kuwaiti'], Kyrgyzstan: ['kyrgyz'], Laos: ['lao', 'laotian'],
  Latvia: ['latvian'], Lebanon: ['lebanese'], Libya: ['libyan'], Liechtenstein: ['liechtensteiner'], Lithuania: ['lithuanian'],
  Luxembourg: ['luxembourgish', 'luxembourger'], Malaysia: ['malaysian'], Maldives: ['maldivian'], Malta: ['maltese'],
  Mauritania: ['mauritanian'], Moldova: ['moldovan'], Monaco: ['monegasque'], Montenegro: ['montenegrin'], Morocco: ['moroccan'],
  Myanmar: ['burmese', 'burma'], Nepal: ['nepalese', 'nepali'], 'New Zealand': ['new zealander'], 'North Macedonia': ['macedonian', 'macedonia'],
  Norway: ['norwegian'], Oman: ['omani'], Pakistan: ['pakistani'], 'Palestinian Territory': ['palestinian', 'palestine'],
  Philippines: ['filipino', 'filipina', 'philippine'], Poland: ['polish'], Portugal: ['portuguese'], Qatar: ['qatari'], Romania: ['romanian'],
  Russia: ['russian', 'russian federation'], 'San Marino': ['sammarinese'], 'Saudi Arabia': ['saudi', 'saudi arabian', 'ksa'],
  Serbia: ['serbian'], Singapore: ['singaporean'], Slovakia: ['slovak', 'slovakian'], Slovenia: ['slovenian', 'slovene'], Somalia: ['somali'],
  'South Africa': ['south african'], Spain: ['spanish'], 'Sri Lanka': ['sri lankan'], Sudan: ['sudanese'], Sweden: ['swedish'],
  Switzerland: ['swiss'], Syria: ['syrian'], Tajikistan: ['tajik', 'tajikistani'], Thailand: ['thai'],
  'The Netherlands': ['netherlands', 'dutch', 'holland'], 'Timor Leste': ['timorese', 'east timor', 'timor-leste'], Tunisia: ['tunisian'],
  Turkmenistan: ['turkmen'], Ukraine: ['ukrainian'], 'United Arab Emirates': ['emirati', 'uae'],
  'United Kingdom': ['british', 'uk', 'great britain', 'english', 'scottish', 'welsh'], 'United States': ['american', 'usa', 'united states of america'],
  Uzbekistan: ['uzbek', 'uzbekistani'], Vietnam: ['vietnamese', 'viet nam'], Yemen: ['yemeni'],
};

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The country a stored nationality value means ("Indian" → "India"), or the value itself when it is not one of the regions' countries. */
export function canonicalNationality(value: string): string {
  const k = key(value);
  for (const [country, names] of Object.entries(OTHER_NAMES)) {
    if (key(country) === k || names.includes(k)) return country;
  }
  return value.trim();
}

/** What the search is sent for the ticked nationalities: each one, and every other name of its country. Duplicates removed. */
export function nationalitySearchTerms(selected: string[]): string[] {
  const out = new Map<string, string>();
  for (const v of selected) {
    const country = canonicalNationality(v);
    for (const term of [v.trim(), country, ...(OTHER_NAMES[country] ?? [])]) {
      if (term && !out.has(key(term))) out.set(key(term), term);
    }
  }
  return [...out.values()];
}

/** How many candidates each country of the regions has, from the stored nationality values and their counts (adjectives counted in). */
export function countsByCountry(facets: { value: string; count: number }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of facets) {
    const country = canonicalNationality(f.value);
    counts.set(country, (counts.get(country) ?? 0) + f.count);
  }
  return counts;
}
