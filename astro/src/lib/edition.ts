// Edition-aware matching for Find prices: the same title exists as a paperback, a hardcover,
// an illustrated edition, a deluxe slipcase... and a name match alone can't tell them apart.
// (Real case, October 2026: "Harry Potter and the Half-Blood Prince (Illustrated Edition,
// illustrated by Levi Pinfold)" with no ISBN matched Outland's 179 kr paperback and 359 kr
// hardcover as well as the 579 kr illustrated edition, because all three share the title.)
//
// The edition words come from the FULL product name typed into /add-price — notes in
// parentheses are stripped from the search query (searchName()), but they're exactly where
// "(Illustrated Edition)" or "(Vinyl)" usually is.

export type EditionGroup = {
  key: string
  label: string
  // 'edition' groups name a specific edition; 'format' groups are a physical format, where
  // two values of the same `family` contradict each other (hardcover vs paperback).
  kind: 'edition' | 'format'
  family?: string
  words: string[] // whole words (Latin) or substrings (Japanese), lowercase
}

export const EDITION_GROUPS: EditionGroup[] = [
  { key: 'illustrated', label: 'illustrated', kind: 'edition', words: ['illustrated', 'illustrert', 'illustrerte', 'イラスト版', '挿絵'] },
  { key: 'deluxe', label: 'deluxe', kind: 'edition', words: ['deluxe', 'luksus', 'luksusutgave', 'デラックス', '豪華版'] },
  { key: 'collectors', label: "collector's", kind: 'edition', words: ["collector's", 'collectors', 'collector', 'samleutgave', 'samlerutgave', 'コレクターズ'] },
  { key: 'limited', label: 'limited', kind: 'edition', words: ['limited', 'begrenset', '限定', '限定版'] },
  { key: 'special', label: 'special edition', kind: 'edition', words: ['special edition', 'spesialutgave', '特装版', '特別版'] },
  { key: 'anniversary', label: 'anniversary', kind: 'edition', words: ['anniversary', 'jubileum', 'jubileumsutgave', '周年', '記念'] },
  { key: 'steelbook', label: 'steelbook', kind: 'edition', words: ['steelbook', 'スチールブック'] },
  { key: 'hardcover', label: 'hardcover', kind: 'format', family: 'binding', words: ['hardcover', 'hardback', 'hc', 'innbundet', 'ハードカバー'] },
  { key: 'paperback', label: 'paperback', kind: 'format', family: 'binding', words: ['paperback', 'softcover', 'heftet', 'pocketbok', 'ペーパーバック', '文庫'] }, // not "pocket": Pocket Monsters
  { key: 'vinyl', label: 'vinyl', kind: 'format', family: 'audio', words: ['vinyl', 'lp', 'レコード', 'アナログ盤'] },
  { key: 'cd', label: 'CD', kind: 'format', family: 'audio', words: ['cd'] },
]

function hasWord(text: string, word: string): boolean {
  if (/[^\x00-\x7f]/.test(word)) return text.includes(word) // Japanese: no word boundaries
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text)
}

// The edition groups a text mentions.
export function editionKeys(text: string | null | undefined): Set<string> {
  const t = String(text || '').toLowerCase().replace(/[’‘`´]/g, "'")
  return new Set(EDITION_GROUPS.filter((g) => g.words.some((w) => hasWord(t, w))).map((g) => g.key))
}

const byKey = new Map(EDITION_GROUPS.map((g) => [g.key, g]))

// Why a candidate is another edition than the one searched for, or null if it isn't (as far
// as its text says). `candidateText` is its name plus any structured format data.
// - It lacks an edition the search names ("illustrated") -> another edition.
// - It names an extra edition while the search names one too (searching "Illustrated
//   Edition", candidate "Deluxe Illustrated Slipcase Edition") -> another edition. A search
//   that names no edition at all keeps such candidates — they're labelled "check the edition".
// - Formats only conflict when the candidate states a different one of the same family
//   (paperback vs hardcover, CD vs vinyl). A candidate that doesn't state its format at all
//   is kept: most store titles don't say "hardcover", and dropping all of them would lose
//   the right edition just as often as the wrong one.
export function editionConflict(searchedName: string, candidateText: string | null | undefined): string | null {
  const wanted = editionKeys(searchedName)
  if (wanted.size === 0) return null
  const has = editionKeys(candidateText)
  const wantedEditions = [...wanted].filter((k) => byKey.get(k)!.kind === 'edition')

  for (const k of wantedEditions) {
    if (!has.has(k)) return `not the ${byKey.get(k)!.label} edition`
  }
  if (wantedEditions.length) {
    const extra = [...has].find((k) => byKey.get(k)!.kind === 'edition' && !wanted.has(k))
    if (extra) return `a ${byKey.get(extra)!.label} edition`
  }
  for (const k of wanted) {
    const g = byKey.get(k)!
    if (g.kind !== 'format' || has.has(k)) continue
    const other = [...has].find((h) => byKey.get(h)!.family === g.family)
    if (other) return `${byKey.get(other)!.label}, not ${g.label}`
  }
  return null
}
