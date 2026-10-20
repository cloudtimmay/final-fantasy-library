// Enum-like field values for the four collection types (album/game/book/figure), shared by
// every endpoint that creates or updates one of these documents, so a whitelist added in one
// place never drifts out of sync with another — the same reasoning behind
// price-entry-fields.ts's PEOPLE_LIST/CATEGORIES duplication. Must be kept in sync by hand
// with each schema's `options.list` in sanity/schemaTypes/ (album.ts, game.ts, book.ts,
// figure.ts) — there is no shared module path between the Astro app and the Studio package.
//
// Plain string[] exports are for fields where the schema's own list already is the value
// (free-text-looking options like "Soundtrack" or "PS5"), used for server-side whitelist
// checks. {value,label}[] exports are for fields where Studio's list has a separate
// human-readable title (e.g. format's 'vinyl_lp' -> "Vinyl (LP)"), needed to render a
// <select> correctly — not just to validate one.

export const ALBUM_GENRES = ['Soundtrack', 'Remix', 'Jazz', 'Orchestral', 'Other']

export const ALBUM_FORMATS = [
  { value: 'vinyl_lp', label: 'Vinyl (LP)' },
  { value: 'vinyl_single', label: 'Vinyl (Single)' },
  { value: 'cd', label: 'CD' },
  { value: 'cassette', label: 'Cassette' },
  { value: 'digital', label: 'Digital' },
]

export const GAME_PLATFORMS = [
  'NES', 'SNES', 'PS1', 'PS2', 'PS3', 'PS4', 'PS5', 'PSP', 'PSVITA',
  'XBOX', 'PC', 'DS', '3DS', 'SWITCH', 'SWITCH2',
  'GAMECUBE', 'WII', 'WIIU',
]

export const GAME_GENRES = [
  'Action', 'RPG', 'Strategy', 'Simulation', 'Puzzle', 'Adventure',
  'Shooter', 'Sports', 'Fighting', 'Horror', 'Other',
]

export const GAME_COMPLETION_STATUSES = [
  { value: 'backlog', label: 'Not started' },
  { value: 'playing', label: 'Playing' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped', label: 'Dropped' },
]

export const BOOK_GENRES = [
  'Game Guide', 'Fiction', 'Non-fiction', 'Science Fiction', 'Fantasy', 'Mystery',
  'Biography', 'History', 'Science', 'Art', 'Comics / Manga', 'Other',
]

export const BOOK_LANGUAGES = ['English', 'Japanese']

export const BOOK_READ_STATUSES = [
  { value: 'unread', label: 'Unread' },
  { value: 'reading', label: 'Reading' },
  { value: 'read', label: 'Read' },
  { value: 'dnf', label: 'DNF (did not finish)' },
]

export const FIGURE_CATEGORIES = [
  { value: 'figure', label: 'Figure' },
  { value: 'plushie', label: 'Plushie' },
  { value: 'wearable', label: 'Wearable' },
  { value: 'other', label: 'Other' },
]

// An entry is either one field name, or an array of field names meaning "at least one of
// these must be filled in" (e.g. an album only needs an artist OR a composer, not both).
export type ImportantField = string | string[]
export type CollectionType = 'album' | 'game' | 'book' | 'figure'

export const IMPORTANT_FIELDS: Record<CollectionType, ImportantField[]> = {
  album: [['artist', 'composer'], 'barcode', 'catalogNumber', 'releaseDate'],
  game: ['platform', 'year', 'developer'],
  book: ['author', 'publisher', 'isbn', 'year'],
  figure: ['manufacturer', 'series'],
}

function fieldLabel(field: string): string {
  // Human-friendly label for a single field name — the handful this needs aren't a 1:1
  // match with their schema `title` (e.g. "catalogNumber" -> "Catalog number"), so this is
  // a small dedicated map rather than a generic camelCase splitter.
  const LABELS: Record<string, string> = {
    artist: 'artist', composer: 'composer', barcode: 'barcode', catalogNumber: 'catalog number',
    releaseDate: 'release date', platform: 'platform', year: 'year', developer: 'developer',
    author: 'author', publisher: 'publisher', isbn: 'ISBN', manufacturer: 'manufacturer', series: 'series',
  }
  return LABELS[field] || field
}

function isPresent(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim() !== ''
  return true
}

// Used by the "Missing info" list — considers a document incomplete based on its type's
// IMPORTANT_FIELDS, not on the `needsInfo` flag (which stays a separate, independent manual
// signal — see missing-info.astro). Returns a human-readable label per unsatisfied entry,
// e.g. ["artist or composer", "barcode"].
export function missingImportantFields(type: CollectionType, doc: Record<string, unknown>): string[] {
  const missing: string[] = []
  for (const entry of IMPORTANT_FIELDS[type]) {
    if (Array.isArray(entry)) {
      if (!entry.some((f) => isPresent(doc[f]))) missing.push(entry.map(fieldLabel).join(' or '))
    } else if (!isPresent(doc[entry])) {
      missing.push(fieldLabel(entry))
    }
  }
  return missing
}
