import { defineType, defineField } from 'sanity'

export const shopNote = defineType({
  name: 'shopNote',
  title: 'Shop Note',
  type: 'document',
  icon: () => '📍',
  fields: [
    defineField({ name: 'shopName', title: 'Shop / Place', type: 'string', validation: (R) => R.required() }),
    defineField({
      name: 'placeType',
      title: 'Type',
      type: 'string',
      options: {
        list: [
          { title: '🛍️ Shop', value: 'shop' },
          { title: '🍜 Restaurant', value: 'restaurant' },
          { title: '🗼 Sight to see', value: 'sight' },
          { title: '🏨 Hotel', value: 'hotel' },
          { title: '📌 Other', value: 'other' },
        ],
        layout: 'radio',
      },
      initialValue: 'shop',
    }),
    defineField({
      name: 'trips',
      title: 'Trips',
      description: 'Which trips is this place part of? A place can belong to several.',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'tripSettings' }] }],
    }),
    defineField({
      name: 'area',
      title: 'Area',
      type: 'string',
      options: {
        list: ['Akihabara', 'Ikebukuro', 'Nakano', 'Shinjuku', 'Shibuya', 'Shinagawa', 'Yokohama', 'Osaka', 'Kyoto', 'Tokyo Station', 'Ginza', 'Harajuku', 'Odawara', 'Shizuoka', 'Yoyogi', 'Other'],
      },
    }),
    defineField({
      name: 'openingHours',
      title: 'Opening hours',
      description: 'Free text, e.g. "10:00–20:00, closed Tue" (Japan time).',
      type: 'string',
    }),
    defineField({ name: 'note', title: 'Note', type: 'text', rows: 4 }),
    defineField({
      name: 'priority',
      title: 'Priority',
      type: 'string',
      options: {
        list: [
          { title: 'Must visit', value: 'must' },
          { title: 'Worth a look', value: 'maybe' },
          { title: 'Visited', value: 'visited' },
        ],
        layout: 'radio',
      },
      initialValue: 'maybe',
    }),
    defineField({
      name: 'taxFreeShop',
      title: 'Tax-free shop',
      type: 'boolean',
      description: 'Leave unset if unknown — deliberately no initial value, so "unknown" stays distinguishable from "No".',
    }),
    defineField({ name: 'address', title: 'Address / how to find', type: 'string' }),
    defineField({ name: 'website', title: 'Website', type: 'url' }),
    defineField({ name: 'latitude', title: 'Latitude', type: 'number' }),
    defineField({ name: 'longitude', title: 'Longitude', type: 'number' }),
    defineField({
      name: 'photos',
      title: 'Shop photos',
      description: 'Floor guides, shelves, the entrance … Added and ordered on the shop\'s edit page.',
      type: 'array',
      of: [
        {
          type: 'image',
          options: { hotspot: false },
          fields: [
            defineField({ name: 'caption', title: 'Caption', type: 'string', description: 'E.g. "Floor guide", "4F retro games".' }),
          ],
        },
      ],
    }),
  ],
  preview: {
    select: { title: 'shopName', subtitle: 'area', placeType: 'placeType' },
    prepare({ title, subtitle, placeType }) {
      const icons: Record<string, string> = { shop: '🛍️', restaurant: '🍜', sight: '🗼', hotel: '🏨', other: '📌' }
      return {
        title,
        subtitle: [placeType ? (placeType.charAt(0).toUpperCase() + placeType.slice(1)) : '', subtitle].filter(Boolean).join(' · '),
        media: () => icons[placeType] || '📍',
      }
    },
  },
})