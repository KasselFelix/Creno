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
  const time = findTime(folded);
  return {
    category: findCategory(folded),
    place: findPlace(text, folded, time.spans),
    nearMe: NEAR_ME.test(folded),
    radiusKm: findRadius(folded),
    priceMaxEuros: findPrice(folded),
    date: findDate(folded, today),
    timeOfDay: time.timeOfDay,
    startAfter: time.startAfter,
    startBefore: time.startBefore,
    ignored: findIgnored(text, folded, time.spans),
  };
}

/** Date citée dans la phrase, s'il y en a une (le service la reprend quand le modèle l'a manquée). */
export function keywordDate(query: string, today: string): string | null {
  return findDate(fold(query.replace(/\s+/g, ' ').trim()), today);
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

const WEEKDAY_WORD = new RegExp(String.raw`\b(${WEEKDAYS.join('|')})\b`);

/**
 * Recoupe la date du modèle avec le jour cité : malgré le calendrier fourni et une température
 * nulle, il se trompe parfois de ligne (« lundi » lu comme le mardi). Si la phrase nomme un jour et
 * que la date n'y tombe pas, la date calculée ici l'emporte.
 */
export function checkWeekday(
  extraction: AiSearchExtraction,
  query: string,
  today: string,
): AiSearchExtraction {
  if (extraction.date === null) return extraction;
  const folded = fold(query.replace(/\s+/g, ' ').trim());
  const named = WEEKDAY_WORD.exec(folded);
  if (!named || weekdayOf(extraction.date) === WEEKDAYS.indexOf(named[1]!)) return extraction;
  return { ...extraction, date: findDate(folded, today) };
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
  if (/\b(aujourd'?\s?hui|ce soir|ce midi|ce matin|cet apres[- ]midi|cet aprem)\b/.test(folded)) {
    return today;
  }
  if (/\bce (week-?end|we)\b/.test(folded)) return nextWeekday(today, 6);
  const weekday = WEEKDAY_WORD.exec(folded);
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
function findPlace(text: string, folded: string, timeSpans: Span[]): string | null {
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
    if (startsIn(timeSpans, head.start)) continue;
    if (PLACE_STOP_WORDS.has(head.word) && !['le', 'la', 'les'].includes(head.word)) continue;
    // Un nombre ouvre un lieu seulement s'il s'agit d'un numéro de rue (« près du 12 rue Oberkampf »).
    if (/^\d/.test(head.word) && !STREET_WORDS.test(tokens[first + 1]?.word ?? '')) continue;

    let last = first;
    for (let j = first; j < tokens.length; j++) {
      const token = tokens[j]!;
      if (j > first && (PLACE_STOP_WORDS.has(token.word) || isCategoryWord(token.word))) break;
      // « à Lyon l'après-midi », « à Lyon en soirée » : le lieu s'arrête où commence l'horaire.
      if (j > first && startsIn(timeSpans, token.start)) break;
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

// Morceaux que les filtres ne couvrent pas, signalés au visiteur : durées, nombre de personnes, et
// heures qui ne font pas une plage (heure seule, heure impossible, plage inversée).
const IGNORED_PATTERNS = [
  /\b(pendant|pour|durant)\s+\d{1,2}\s*h(\s*\d{2})?\b/g,
  /\b((apres|avant|vers|a|des|entre|de|jusqu'?a)\s+)?\d{1,2}\s*h(\s*\d{2})?\b(\s*(et|a|-)\s*\d{1,2}\s*h(\s*\d{2})?\b)?/g,
  /\b(pour\s+)?\d+\s*(personnes|personne|pers|joueurs|joueur|invites|invite|participants|participant)\b/g,
  /\b(pendant\s+)?\d+\s*(heures|heure|minutes|minute|min)\b/g,
];

function findIgnored(text: string, folded: string, timeSpans: Span[]): string[] {
  // Les expressions horaires comprises sont réservées : elles ne sont pas « ignorées ».
  const spans: Span[] = [...timeSpans];
  for (const pattern of IGNORED_PATTERNS) {
    for (const match of folded.matchAll(pattern)) {
      const span = { start: match.index, end: match.index + match[0].length };
      if (!spans.some((other) => span.start < other.end && other.start < span.end))
        spans.push(span);
    }
  }
  return spans
    .filter((span) => !timeSpans.includes(span))
    .sort((a, b) => a.start - b.start)
    .map((span) => text.slice(span.start, span.end).trim());
}

interface Span {
  start: number;
  end: number;
}

const startsIn = (spans: Span[], index: number) =>
  spans.some((span) => index >= span.start && index < span.end);

// Périodes ; « une soirée » (un événement) n'en est pas une, « en soirée » si.
const TIME_OF_DAY_WORDS: [NonNullable<AiSearchExtraction['timeOfDay']>, RegExp][] = [
  ['afternoon', /\b(l'|d')?(apres[- ]midi|aprem)\b/],
  ['morning', /\b((en|dans la)\s+)?matinee\b|\bmatin\b/],
  ['evening', /\b(en|dans la)\s+soiree\b|\bsoir\b/],
];

// Une heure : « 18 h », « 18h30 », « 18 h 30 », « 18 heures », « 18:30 ».
const HOUR = String.raw`\d{1,2}\s*(?:h(?:eures?)?(?:\s*\d{2})?|:\d{2})\b`;
const HOUR_PARTS = /(\d{1,2})\s*(?:h(?:eures?)?(?:\s*(\d{2}))?|:(\d{2}))/g;

/**
 * Expressions horaires, introduites par un mot : une heure seule (« samedi 18h ») ou une durée
 * (« pendant 2h ») n'est pas une plage. Les plus longues d'abord ; une expression qui en chevauche
 * une autre déjà trouvée est écartée. `around` : la plage entoure l'heure citée.
 */
const HOUR_EXPRESSIONS: [kind: 'range' | 'after' | 'before' | 'around' | 'at', RegExp][] = [
  ['range', new RegExp(String.raw`\bentre\s+${HOUR}\s+et\s+${HOUR}`, 'g')],
  ['range', new RegExp(String.raw`\bde\s+${HOUR}\s+(?:a|jusqu'?a)\s+${HOUR}`, 'g')],
  ['range', new RegExp(String.raw`\b${HOUR}\s*(?:-|a)\s*${HOUR}`, 'g')],
  ['after', new RegExp(String.raw`\b(?:apres|a partir de|des)\s+${HOUR}`, 'g')],
  ['before', new RegExp(String.raw`\b(?:avant|jusqu'?a)\s+${HOUR}`, 'g')],
  ['around', new RegExp(String.raw`\bvers\s+${HOUR}`, 'g')],
  ['at', new RegExp(String.raw`\ba\s+${HOUR}`, 'g')],
];

const DAY_MINUTES = 24 * 60;
const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Minutes depuis minuit des heures d'une expression ; `null` si l'une est impossible (25 h, 18h75). */
function hoursOf(expression: string): number[] | null {
  const minutes = [...expression.matchAll(HOUR_PARTS)].map((match) => {
    const hours = Number(match[1]);
    const mins = Number(match[2] ?? match[3] ?? 0);
    return hours <= 24 && mins < 60 ? hours * 60 + mins : Number.NaN;
  });
  return minutes.some((value) => Number.isNaN(value) || value > DAY_MINUTES) ? null : minutes;
}

/** Bornes `[après, avant)` en minutes d'une expression, ou `null` si elle ne fait pas une plage. */
function boundsOf(kind: (typeof HOUR_EXPRESSIONS)[number][0], expression: string) {
  const hours = hoursOf(expression);
  if (!hours) return null;
  const [first, second] = hours as [number, number?];
  const bounds = {
    range: { after: first, before: second },
    after: { after: first, before: undefined },
    before: { after: undefined, before: first },
    around: { after: Math.max(first - 60, 0), before: Math.min(first + 60, DAY_MINUTES) },
    at: { after: first, before: Math.min(first + 60, DAY_MINUTES) },
  }[kind];
  // Une heure de début est avant minuit ; « avant 24 h » est permis ; une plage va dans l'ordre.
  if (bounds.after !== undefined && bounds.after >= DAY_MINUTES) return null;
  if (bounds.after !== undefined && bounds.before !== undefined && bounds.after >= bounds.before) {
    return null;
  }
  return bounds;
}

function findTime(
  folded: string,
): Pick<AiSearchExtraction, 'timeOfDay' | 'startAfter' | 'startBefore'> & { spans: Span[] } {
  const spans: Span[] = [];
  let timeOfDay: AiSearchExtraction['timeOfDay'] = null;
  let periodIndex = Infinity;
  for (const [period, pattern] of TIME_OF_DAY_WORDS) {
    const match = pattern.exec(folded);
    if (!match) continue;
    spans.push({ start: match.index, end: match.index + match[0].length });
    // Plusieurs périodes : la première citée l'emporte.
    if (match.index < periodIndex) {
      timeOfDay = period;
      periodIndex = match.index;
    }
  }

  const found: { start: number; after?: number; before?: number }[] = [];
  for (const [kind, pattern] of HOUR_EXPRESSIONS) {
    for (const match of folded.matchAll(pattern)) {
      const span = { start: match.index, end: match.index + match[0].length };
      if (spans.some((other) => span.start < other.end && other.start < span.end)) continue;
      const bounds = boundsOf(kind, match[0]);
      // Impossible ou inversée : pas réservée, elle sera signalée comme ignorée.
      if (!bounds) continue;
      spans.push(span);
      found.push({ start: span.start, ...bounds });
    }
  }
  // Dans l'ordre de la phrase, chaque borne prend la première valeur citée.
  found.sort((a, b) => a.start - b.start);
  const after = found.find((bounds) => bounds.after !== undefined)?.after;
  const before = found.find((bounds) => bounds.before !== undefined)?.before;
  return {
    timeOfDay,
    startAfter: after === undefined ? null : hhmm(after),
    startBefore: before === undefined ? null : hhmm(before),
    spans,
  };
}
