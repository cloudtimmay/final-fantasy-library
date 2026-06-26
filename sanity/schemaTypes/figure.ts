import { defineType, defineField } from 'sanity'
import { sharedFields } from './shared'
import { ExternalImagePreview } from '../components/ExternalImagePreview'
import { MfcImport } from '../components/MfcImport'

export const figure = defineType({
  name: 'figure',
  title: 'Figure',
  type: 'document',
  icon: () => '🗿',
  fields: [
    defineField({ name: 'title', title: 'Name / Title', type: 'string', validation: (R) => R.required() }),
    defineField({ name: 'series', title: 'Series / Franchise', type: 'string' }),
    defineField({ name: 'manufacturer', title: 'Manufacturer', type: 'string' }),
    defineField({ name: 'year', title: 'Release year', type: 'number' }),
    defineField({ name: 'needsInfo', title: 'Missing info', type: 'boolean', initialValue: false }),
    defineField({
      name: 'barcode',
      title: 'Barcode (JAN)',
      type: 'string',
      description: 'Scan/type the JAN. Use the lookup buttons to find it on MFC, then paste the item URL below to auto-fill.',
      components: { input: MfcImport },
    }),
    defineField({ name: 'externalImageUrl', title: 'External Image URL', type: 'url' }),
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
    select: {
      title: 'title',
      subtitle: 'series',
      image: 'image',
      externalImageUrl: 'externalImageUrl',
    },
    prepare({ title, subtitle, image, externalImageUrl }) {
      return {
        title,
        subtitle,
        media: image
          ? image
          : () => ExternalImagePreview({ title, subtitle, externalImageUrl }),
      }
    },
  },
})