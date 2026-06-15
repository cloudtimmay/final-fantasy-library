import { defineType, defineField } from 'sanity'
import { sharedFields } from './shared'

export const figure = defineType({
  name: 'figure',
  title: 'Figure',
  type: 'document',
  icon: () => '🗿',
  fields: [
    defineField({ name: 'title', title: 'Name / Title', type: 'string', validation: (R) => R.required() }),
    defineField({ name: 'series', title: 'Series / Franchise', type: 'string' }),
    defineField({ name: 'year', title: 'Release year', type: 'number' }),
    defineField({
      name: 'scale',
      title: 'Scale',
      type: 'string',
      options: {
        list: ['1:6', '1:12', '1:18', '1:24', '1:64', 'Nendoroid', 'Figma', 'Statue', 'Other'],
      },
    }),
    defineField({
      name: 'condition',
      title: 'Condition',
      type: 'string',
      options: {
        list: [
          { title: 'Mint in box', value: 'mint_box' },
          { title: 'Mint, no box', value: 'mint_nobox' },
          { title: 'Good', value: 'good' },
          { title: 'Displayed (wear)', value: 'displayed' },
          { title: 'Damaged', value: 'damaged' },
        ],
        layout: 'radio',
      },
    }),
    defineField({
      name: 'location',
      title: 'Display location',
      type: 'string',
      description: 'e.g. "Shelf A", "Storage box 3"',
    }),
    ...sharedFields.map((f) => defineField(f as any)),
  ],
  preview: {
    select: { title: 'title', subtitle: 'series' },
  },
})
