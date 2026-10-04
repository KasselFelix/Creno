import { AI_PLACE_MAX, type AiSearchExtraction, AI_PRICE_MAX_EUROS } from '@creno/shared';
import { addLocalDays } from '../availability/slots.engine.js';

/**
 * Analyse par mots-clés : repli quand le modèle est absent, en panne ou hors budget. Fonction pure
 * (la date du jour est un paramètre), en français, moins fine que le modèle mais jamais en panne.
 * Elle produit la même forme de sortie que le modèle, validée par le même schéma.
 */
export function parseKeywords(query: string, today: string): AiSearchExtraction {
  const text = query.replace(/\s+/g, ' ').trim();
  const folded = fold(text);
  return {
    category: findCategory(folded),
    place: findPlace(text, folded),
    nearMe: NEAR_ME.test(folded),
    radiusKm: findRadius(folded),
    priceMaxEuros: findPrice(folded),
    date: findDate(folded, today),
    ignored: findIgnored(text, folded),
  };
}

const SPECIAL_CHARS: Record<string, string> = { '’': "'", '‘': "'", ʼ: "'", ' ': ' ' };

/**
 * Minuscules, sans accents, apostrophes droites. Un caractère donne exactement un caractère : une
 * position trouvée dans le texte plié vaut dans le texte d'origine, dont on garde la casse et les
 * accents (« Évry »).
 */
export function fold(text: string): string {
  let folded = '';
  for (const char of text.split('')) {
    const mapped = SPECIAL_CHARS[char] ?? char.normalize('NFD')[0]!.toLowerCase();
    folded += mapped.length === 1 ? mapped : char;
  }
  return folded;
}

// Catégories : le premier mot reconnu dans la phrase l'emporte. « Autre » n'est jamais déduit.
const CATEGORY_WORDS: [AiSearchExtraction['category'] & string, RegExp][] = [
  [
    'hairdresser',
    /\b(coiffeur|coiffeuse|coiffeurs|coiffure|coiffures|barbier|barbiers|barber|cheveux)\b/,
  ],
  ['sports_field', /\b(terrain|terrains|foot|football|five|futsal|tennis|padel)\b/],
  ['photographer', /\b(photographe|photographes|photo|photos|shooting)\b/],
  ['room', /\b(salle|salles|reunion|reunions|seminaire|seminaires)\b/],
];

function findCategory(folded: string): AiSearchExtraction['category'] {
  let best: { category: AiSearchExtraction['category']; index: number } | null = null;
  for (const [category, pattern] of CATEGORY_WORDS) {
    const index = folded.search(pattern);
    if (index !== -1 && (!best || index < best.index)) best = { category, index };
  }
  return best?.category ?? null;
}

const NEAR_ME =
  /\b(pres de (chez )?moi|autour de (chez )?moi|proche de (chez )?moi|a cote de (chez )?moi|a proximite)\b/;

// Un nombre qui n'est pas un prix : distance, heure, durée, nombre de personnes.
const NOT_A_PRICE = String.raw`(?!\d|[.,]\d|\s*(km|h\b|heures?|min|minutes?|pers|personnes?|joueurs?|invites?|participants?))`;
const PRICE_AFTER_LIMIT = new RegExp(
  String.raw`(moins de|max(imum)?|jusqu'?a|au plus|pas plus de|inferieur a|budget( de)?|<=?|≤)\s*(\d+([.,]\d{1,2})?)${NOT_A_PRICE}`,
);
const PRICE_WITH_CURRENCY = /(\d+([.,]\d{1,2})?)\s*(€|euros?\b|eur\b)/;
// « à partir de 50 € » est un minimum, pas un maximum.
const PRICE_MINIMUM_BEFORE = /(a partir de|des|au moins|minimum|plus de)\s*$/;

function findPrice(folded: string): number | null {
  const limited = PRICE_AFTER_LIMIT.exec(folded);
  const withCurrency = PRICE_WITH_CURRENCY.exec(folded);
  let raw: string | undefined;
  if (limited) raw = limited[4];
  else if (withCurrency && !PRICE_MINIMUM_BEFORE.test(folded.slice(0, withCurrency.index))) {
    raw = withCurrency[1];
  }
  if (raw === undefined) return null;
  const euros = Number(raw.replace(',', '.'));
  return euros <= AI_PRICE_MAX_EUROS ? euros : null;
}

function findRadius(folded: string): number | null {
  const match = /\b(\d{1,3})\s*km\b/.exec(folded);
  if (!match) return null;
  const km = Number(match[1]);
  return km >= 1 && km <= 50 ? km : null;
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = [
  'janvier',
  'fevrier',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'aout',
  'septembre',
  'octobre',
  'novembre',
  'decembre',
];

/** Jour de la semaine (0 = dimanche) d'une date du calendrier. */
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Prochaine occurrence du jour `weekday` (0 = dimanche), aujourd'hui compris. */
const nextWeekday = (today: string, weekday: number) =>
  addLocalDays(today, (weekday - weekdayOf(today) + 7) % 7);

/** Date réelle `YYYY-MM-DD` ; sans année, la prochaine occurrence (aujourd'hui compris). */
function calendarDate(day: number, month: number, year: number | undefined, today: string) {
  const build = (y: number) => {
    const date = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const real = new Date(`${date}T12:00:00Z`).toISOString().startsWith(date);
    return real ? date : null;
  };
  if (year !== undefined) return year >= 2000 && year <= 2099 ? build(year) : null;
  const thisYear = Number(today.slice(0, 4));
  const date = build(thisYear);
  if (date === null) return build(thisYear + 1); // 29 février d'une année non bissextile
  return date >= today ? date : build(thisYear + 1);
}

function findDate(folded: string, today: string): string | null {
  // Une date écrite l'emporte sur un jour relatif (« samedi 12/10 »).
  const numeric = /\b(\d{1,2})\/(\d{1,2})(\/(\d{4}))?\b/.exec(folded);
  if (numeric) {
    const year = numeric[4] === undefined ? undefined : Number(numeric[4]);
    return calendarDate(Number(numeric[1]), Number(numeric[2]), year, today);
  }
  const written = new RegExp(
    String.raw`\b(\d{1,2})(er)?\s+(${MONTHS.join('|')})(\s+(\d{4}))?\b`,
  ).exec(folded);
  if (written) {
    const year = written[5] === undefined ? undefined : Number(written[5]);
    return calendarDate(Number(written[1]), MONTHS.indexOf(written[3]!) + 1, year, today);
  }
  // « après-demain » avant « demain », qui en fait partie.
  if (/\bapres[- ]demain\b/.test(folded)) return addLocalDays(today, 2);
  if (/\bdemain\b/.test(folded)) return addLocalDays(today, 1);
  if (/\b(aujourd'?\s?hui|ce soir|ce midi|ce matin|cet apres-midi)\b/.test(folded)) return today;
  if (/\bce (week-?end|we)\b/.test(folded)) return nextWeekday(today, 6);
  const weekday = new RegExp(String.raw`\b(${WEEKDAYS.join('|')})\b`).exec(folded);
  return weekday ? nextWeekday(today, WEEKDAYS.indexOf(weekday[1]!)) : null;
}

// Prépositions qui introduisent un lieu (« à Lyon », « près de Nantes ») ; les plus longues d'abord.
const PLACE_PREPOSITIONS = [
  ['pres', 'de'],
  ['autour', 'de'],
  ['a', 'cote', 'de'],
  ['vers'],
  ['sur'],
  ['a'],
];

// Mots qui terminent un lieu : prépositions, mots de prix, de date, de catégorie, liaisons.
const PLACE_STOP_WORDS = new Set([
  'a',
  'sur',
  'vers',
  'pres',
  'autour',
  'pour',
  'avec',
  'sans',
  'entre',
  'dans',
  'moins',
  'max',
  'maximum',
  "jusqu'a",
  'budget',
  'rayon',
  'et',
  'ou',
  'ce',
  'cette',
  'cet',
  'demain',
  'apres-demain',
  "aujourd'hui",
  'apres',
  'avant',
  'le',
  'la',
  'les',
  'semaine',
  'prochain',
  'prochaine',
  'soir',
  'matin',
  ...WEEKDAYS,
  ...MONTHS,
]);

// « à domicile », « à partir de », « à proximité », « près de moi » : pas des lieux.
const NOT_A_PLACE = new Set([
  'domicile',
  'partir',
  'proximite',
  'moi',
  'chez',
  'cote',
  'emporter',
  'distance',
  'midi',
  'minuit',
]);

const STREET_WORDS = /^(rue|avenue|av|bd|boulevard|place|chemin|allee|impasse|quai|cours|route)$/;

const isCategoryWord = (word: string) => CATEGORY_WORDS.some(([, pattern]) => pattern.test(word));

/**
 * Lieu cité après une préposition, avec la casse et les accents d'origine (« à Évry » → « Évry »).
 * Le géocodeur dira ensuite s'il existe ; le service ne garde un lieu des mots-clés que si c'est une
 * commune, ou un libellé qui contient ce texte.
 */
function findPlace(text: string, folded: string): string | null {
  const tokens = [...folded.matchAll(/\S+/g)].map((match) => ({
    word: match[0].replace(/[,.;:!?]+$/, ''),
    start: match.index,
    end: match.index + match[0].length,
    closesClause: /[,.;:!?]$/.test(match[0]),
  }));

  for (let i = 0; i < tokens.length; i++) {
    const preposition = PLACE_PREPOSITIONS.find((words) =>
      words.every((word, offset) => tokens[i + offset]?.word === word),
    );
    if (!preposition) continue;
    const first = i + preposition.length;
    const head = tokens[first];
    // « à domicile », « à moins de 5 km », « à samedi » : la préposition n'ouvre pas un lieu. Un
    // article ouvre un lieu (« à la Défense ») mais ne le termine pas seul.
    if (!head || NOT_A_PLACE.has(head.word) || isCategoryWord(head.word)) continue;
    if (PLACE_STOP_WORDS.has(head.word) && !['le', 'la', 'les'].includes(head.word)) continue;
    // Un nombre ouvre un lieu seulement s'il s'agit d'un numéro de rue (« près du 12 rue Oberkampf »).
    if (/^\d/.test(head.word) && !STREET_WORDS.test(tokens[first + 1]?.word ?? '')) continue;

    let last = first;
    for (let j = first; j < tokens.length; j++) {
      const token = tokens[j]!;
      if (j > first && (PLACE_STOP_WORDS.has(token.word) || isCategoryWord(token.word))) break;
      // Un nombre après le début du lieu est un prix, une heure ou un code postal : le lieu s'arrête.
      if (j > first && /^\d/.test(token.word)) break;
      if (text.slice(tokens[first]!.start, token.end).length > AI_PLACE_MAX) break;
      last = j;
      if (token.closesClause) break;
    }
    const place = text
      .slice(tokens[first]!.start, tokens[last]!.end)
      .replace(/[,.;:!?]+$/, '')
      .trim();
    if (place && !PLACE_STOP_WORDS.has(fold(place)) && !isCategoryWord(fold(place))) return place;
  }
  return null;
}

// Morceaux que les filtres ne couvrent pas, signalés au visiteur : heures, durées, nombre de personnes.
const IGNORED_PATTERNS = [
  /\b((apres|avant|vers|a|des|entre|de)\s+)?\d{1,2}\s*h(\s*\d{2})?\b(\s+(et|a)\s+\d{1,2}\s*h(\s*\d{2})?\b)?/g,
  /\b(pour\s+)?\d+\s*(personnes|personne|pers|joueurs|joueur|invites|invite|participants|participant)\b/g,
  /\b(pendant\s+)?\d+\s*(heures|heure|minutes|minute|min)\b/g,
];

function findIgnored(text: string, folded: string): string[] {
  const spans: { start: number; end: number }[] = [];
  for (const pattern of IGNORED_PATTERNS) {
    for (const match of folded.matchAll(pattern)) {
      const span = { start: match.index, end: match.index + match[0].length };
      if (!spans.some((other) => span.start < other.end && other.start < span.end))
        spans.push(span);
    }
  }
  return spans
    .sort((a, b) => a.start - b.start)
    .map((span) => text.slice(span.start, span.end).trim());
}
