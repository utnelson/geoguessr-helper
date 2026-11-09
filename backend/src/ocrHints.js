// OCR-Text → Länder-Vorschläge: Schriftsysteme (Unicode-Bereiche) und typische Sonderzeichen.
// Bewusst als einfache Tabelle gehalten – gern ergänzen. ISO-Codes wie in countries.geojson.

/** Schriftsysteme: Unicode-Bereich → Länder (Reihenfolge egal) */
const SCRIPTS = [
  { name: 'Kyrillisch', re: /[Ѐ-ӿ]/g, countries: ['RU', 'UA', 'BY', 'BG', 'RS', 'MK', 'ME', 'KZ', 'KG', 'MN'] },
  { name: 'Griechisch', re: /[Ͱ-Ͽ]/g, countries: ['GR', 'CY'] },
  { name: 'Hebräisch', re: /[֐-׿]/g, countries: ['IL'] },
  { name: 'Arabisch', re: /[؀-ۿ]/g, countries: ['AE', 'JO', 'TN', 'QA', 'OM', 'LB', 'IL', 'EG', 'MA', 'SA'] },
  { name: 'Thai', re: /[฀-๿]/g, countries: ['TH'] },
  { name: 'Laotisch', re: /[຀-໿]/g, countries: ['LA'] },
  { name: 'Khmer', re: /[ក-៿]/g, countries: ['KH'] },
  { name: 'Birmanisch', re: /[က-႟]/g, countries: ['MM'] },
  { name: 'Georgisch', re: /[Ⴀ-ჿ]/g, countries: ['GE'] },
  { name: 'Armenisch', re: /[԰-֏]/g, countries: ['AM'] },
  { name: 'Devanagari', re: /[ऀ-ॿ]/g, countries: ['IN', 'NP'] },
  { name: 'Bengalisch', re: /[ঀ-৿]/g, countries: ['BD', 'IN'] },
  { name: 'Tamil', re: /[஀-௿]/g, countries: ['IN', 'LK'] },
  { name: 'Singhalesisch', re: /[඀-෿]/g, countries: ['LK'] },
  { name: 'Hangul', re: /[가-힯ᄀ-ᇿ]/g, countries: ['KR'] },
  { name: 'Kana (Japanisch)', re: /[぀-ヿ]/g, countries: ['JP'] },
  { name: 'Chinesische Zeichen', re: /[一-鿿]/g, countries: ['CN', 'TW', 'HK', 'MO', 'JP'] },
  { name: 'Äthiopisch', re: /[ሀ-፿]/g, countries: ['ET'] },
  { name: 'Vietnamesisch', re: /[Ạ-ỹơư]/gi, countries: ['VN'], min: 1 }, // diese Zeichen gibt es nur im Vietnamesischen
];

const SLAVIC_LATIN = ['HR', 'SI', 'CZ', 'SK', 'LT', 'LV', 'RS', 'BA', 'ME'];
const SPANISH = ['ES', 'MX', 'AR', 'CL', 'CO', 'PE', 'EC', 'BO', 'UY', 'GT', 'DO', 'PY', 'CR', 'PA'];

/** Sonderzeichen (klein) → Länder */
const CHARS = {
  ő: ['HU'], ű: ['HU'],
  ł: ['PL'], ś: ['PL'], ź: ['PL'], ż: ['PL'], ń: ['PL'], ą: ['PL', 'LT'], ę: ['PL', 'LT'],
  ř: ['CZ'], ů: ['CZ'], ě: ['CZ'], ď: ['CZ', 'SK'], ť: ['CZ', 'SK'], ň: ['CZ', 'SK'],
  ľ: ['SK'], ĺ: ['SK'], ŕ: ['SK'],
  ğ: ['TR'], ı: ['TR'], ş: ['TR', 'RO'], ș: ['RO'], ț: ['RO'], ţ: ['RO'], ă: ['RO'],
  // đ/ă kommen auch im Vietnamesischen vor – Vietnam aber nur über eindeutige Zeichen (ơ, ư, ạ, ế …, siehe SCRIPTS),
  // sonst landet jedes südslawische Schild auch bei Vietnam
  đ: ['HR', 'RS', 'BA', 'ME'], ć: ['HR', 'RS', 'BA', 'ME', 'PL'],
  č: SLAVIC_LATIN, š: [...SLAVIC_LATIN, 'EE', 'FI'], ž: [...SLAVIC_LATIN, 'EE'],
  ā: ['LV'], ē: ['LV'], ī: ['LV'], ģ: ['LV'], ķ: ['LV'], ļ: ['LV'], ņ: ['LV'], ū: ['LV', 'LT'],
  ė: ['LT'], į: ['LT'], ų: ['LT'],
  õ: ['EE', 'PT', 'BR'], ã: ['PT', 'BR'],
  ä: ['DE', 'AT', 'CH', 'FI', 'SE', 'EE', 'SK'], ö: ['DE', 'AT', 'CH', 'FI', 'SE', 'EE', 'HU', 'IS', 'TR'],
  ü: ['DE', 'AT', 'CH', 'EE', 'HU', 'TR'], ß: ['DE', 'AT'],
  å: ['SE', 'NO', 'DK', 'FI'], æ: ['DK', 'NO', 'IS', 'FO'], ø: ['DK', 'NO', 'FO'], ð: ['IS', 'FO'], þ: ['IS'],
  ñ: SPANISH, ç: ['FR', 'PT', 'BR', 'TR', 'AL', 'ES'], ë: ['AL', 'NL'],
  // kyrillische Besonderheiten
  і: ['UA', 'BY', 'KZ'], ї: ['UA'], є: ['UA'], ґ: ['UA'], ў: ['BY'],
  ђ: ['RS', 'ME'], ћ: ['RS', 'ME'], ј: ['RS', 'MK', 'ME'], љ: ['RS', 'MK', 'ME'], њ: ['RS', 'MK', 'ME'], џ: ['RS', 'MK', 'ME'],
  ќ: ['MK'], ѓ: ['MK'], ѕ: ['MK'],
  ө: ['MN', 'KZ', 'KG'], ү: ['MN', 'KZ', 'KG'], қ: ['KZ'], ғ: ['KZ'], ң: ['KZ', 'KG'], ә: ['KZ'], ұ: ['KZ'],
};

/**
 * Vorschläge aus OCR-Text: [{ iso, score, reasons: ['ő', 'Kyrillisch', …] }], beste zuerst.
 * Ein Zeichen, das nur in einem Land vorkommt, zählt viel; eines, das in vielen vorkommt, wenig.
 */
export function countryHints(text) {
  const scores = new Map();
  const add = (iso, weight, reason) => {
    const s = scores.get(iso) ?? { iso, score: 0, reasons: [] };
    s.score += weight;
    if (!s.reasons.includes(reason)) s.reasons.push(reason);
    scores.set(iso, s);
  };
  const found = new Set();
  for (const script of SCRIPTS) {
    const n = (text.match(script.re) ?? []).length;
    if (n >= (script.min ?? 2)) found.add(script.name);
    if (n >= (script.min ?? 2)) for (const iso of script.countries) add(iso, (3 * Math.min(n, 10)) / 10 / script.countries.length * 3, script.name);
  }
  const lower = text.toLowerCase();
  for (const [ch, countries] of Object.entries(CHARS)) {
    // Vietnamesischer Text enthält auch đ/ă – die dann nicht dem Balkan/Rumänien zuschreiben
    if (found.has('Vietnamesisch') && (ch === 'đ' || ch === 'ă')) continue;
    // Jedes Zeichen zählt einmal – egal in wie vielen OCR-Lesarten es vorkommt
    if (lower.includes(ch)) for (const iso of countries) add(iso, 1 / countries.length, ch);
  }
  return [...scores.values()]
    .map((s) => ({ ...s, score: Math.round(s.score * 100) / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

// ---------- Sprache aus den OCR-Lesarten bestimmen ----------
// Jedes Tesseract-Sprachmodell „liest“ gern die eigenen Sonderzeichen hinein (Lettisch macht aus é ein ē).
// Deshalb nicht alle Lesarten zusammenwerfen, sondern die wahrscheinlichste Sprache wählen:
// die sicherste Lesart, die typische Zeichen IHRER Sprache enthält.

/** Tesseract-Sprache → typische Zeichen + Anzeigename */
const LANGS = {
  hun: ['őű', 'Ungarisch'], pol: ['łśźżńąę', 'Polnisch'], ces: ['řůě', 'Tschechisch'], slk: ['ľĺŕô', 'Slowakisch'],
  tur: ['ğış', 'Türkisch'], ron: ['șțţăî', 'Rumänisch'], hrv: ['đ', 'Kroatisch/Serbisch/Bosnisch (lateinisch)'], lav: ['āēīģķļņ', 'Lettisch'],
  lit: ['ėįų', 'Litauisch'], est: ['õ', 'Estnisch'], isl: ['ðþ', 'Isländisch'], dan: ['æø', 'Dänisch'],
  nor: ['æø', 'Norwegisch'], swe: ['å', 'Schwedisch'], fin: ['å', 'Finnisch'], deu: ['ß', 'Deutsch'],
  vie: ['ơư', 'Vietnamesisch'], sqi: ['ë', 'Albanisch'], por: ['ãõ', 'Portugiesisch'], spa: ['ñ', 'Spanisch'],
  ukr: ['іїєґ', 'Ukrainisch'], srp: ['ђћџ', 'Serbisch'], mkd: ['ќѓѕ', 'Mazedonisch'], mon: ['өү', 'Mongolisch'],
  rus: ['ыэ', 'Russisch'],
};

/**
 * OCR-Ergebnis (mit variants je Sprachmodell) → { language, hints }.
 * language: { code, name, confidence } der vermutlich gelesenen Sprache oder null.
 */
export function hintsFromOcr(result) {
  const variants = result.variants ?? [];
  const candidates = variants
    .filter((v) => LANGS[v.lang] && [...LANGS[v.lang][0]].some((ch) => v.text.toLowerCase().includes(ch)))
    .sort((a, b) => b.confidence - a.confidence);
  const chosen = candidates[0] ?? null;
  const combined = variants.find((v) => v.lang.includes('+')); // alle Sprachen zusammen – oft gut bei Polnisch
  const texts = [chosen?.text, combined?.text, result.text].filter(Boolean);
  return {
    language: chosen ? { code: chosen.lang, name: LANGS[chosen.lang][1], confidence: chosen.confidence } : null,
    hints: countryHints(texts.join('\n')),
  };
}
