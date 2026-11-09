// shopNote.placeType — the same values and icons as sanity/schemaTypes/shopNote.ts. Sanity's list
// is only a Studio suggestion: the shop APIs validate against PLACE_TYPES.
export const PLACE_TYPES = ['shop', 'restaurant', 'sight', 'hotel', 'area', 'other'] as const
export type PlaceType = (typeof PLACE_TYPES)[number]
export const PLACE_TYPE_INFO: Record<PlaceType, { icon: string; label: string }> = {
  shop: { icon: '🛍️', label: 'Shop' },
  restaurant: { icon: '🍜', label: 'Restaurant' },
  sight: { icon: '🗼', label: 'Sight to see' },
  hotel: { icon: '🏨', label: 'Hotel' },
  area: { icon: '📍', label: 'Area' }, // "explore around here": no opening hours, never closed
  other: { icon: '📌', label: 'Other' },
}
