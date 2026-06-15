// Shared fields used across all collection types
export const sharedFields = [
  {
    name: 'status',
    title: 'Status',
    type: 'string',
    options: {
      list: [
        { title: 'Owned', value: 'owned' },
        { title: 'Wishlist', value: 'wishlist' },
        { title: 'Sold / Given away', value: 'sold' },
        { title: 'Lent out', value: 'lent' },
      ],
      layout: 'radio',
    },
    initialValue: 'owned',
  },
  {
    name: 'rating',
    title: 'Rating',
    type: 'number',
    description: '1–10',
    validation: (Rule: any) => Rule.min(1).max(10).integer(),
  },
  {
    name: 'tags',
    title: 'Tags',
    type: 'array',
    of: [{ type: 'string' }],
    options: { layout: 'tags' },
  },
  {
    name: 'image',
    title: 'Image',
    type: 'image',
    options: {
    hotspot: true,
    },
  },

  {
    name: 'acquiredDate',
    title: 'Acquired',
    type: 'date',
  },
  {
    name: 'purchasePrice',
    title: 'Purchase price (NOK)',
    type: 'number',
  },
  {
    name: 'notes',
    title: 'Notes',
    type: 'text',
    rows: 3,
  },
]
