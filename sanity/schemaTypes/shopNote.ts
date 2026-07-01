import { defineType, defineField } from 'sanity'

export const shopNote = defineType({
  name: 'shopNote',
  title: 'Shop Note',
  type: 'document',
  icon: () => '📍',
  fields: [
    defineField({ name: 'shopName', title: 'Shop / Place', type: 'string', validation: (R) => R.required() }),
    defineField({
      name: 'area',
      title: 'Area',
      type: 'string',
      options: {
        list: ['Akihabara', 'Ikebukuro', 'Nakano', 'Shinjuku', 'Shibuya', 'Other'],
      },
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
    defineField({ name: 'address', title: 'Address / how to find', type: 'string' }),
    defineField({ name: 'latitude', title: 'Latitude', type: 'number' }),
    defineField({ name: 'longitude', title: 'Longitude', type: 'number' }),
  ],
  preview: {
    select: { title: 'shopName', subtitle: 'area' },
  },
})