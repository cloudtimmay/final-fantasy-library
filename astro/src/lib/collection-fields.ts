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
// Not read by anything yet — reserved for a future "Missing info" view, which will consider
// a document incomplete if any of its type's entries here isn't satisfied.
export type ImportantField = string | string[]

export const IMPORTANT_FIELDS: Record<'album' | 'game' | 'book' | 'figure', ImportantField[]> = {
  album: [['artist', 'composer'], 'barcode', 'catalogNumber', 'releaseDate'],
  game: ['platform', 'year', 'developer'],
  book: ['author', 'publisher', 'isbn', 'year'],
  figure: ['manufacturer', 'series'],
}
