import { defineType, defineField } from 'sanity'
import { sharedFields } from './shared'
import { ExternalImagePreview } from '../components/ExternalImagePreview'
import { seriesList } from './seriesList'

export const figure = defineType({
  name: 'figure',
  title: 'Merchandise',
  type: 'document',
  icon: () => '🧸',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (R) => R.required() }),
    defineField({
      name: 'category',
      title: 'Category',
      type: 'string',
      options: {
        list: [
          { title: 'Figure', value: 'figure' },
          { title: 'Plushie', value: 'plushie' },
          { title: 'Wearable', value: 'wearable' },
          { title: 'Other', value: 'other' },
        ],
        layout: 'radio',
      },
      initialValue: 'figure',
    }),
    defineField({
      name: 'series',
      title: 'Series / Franchise',
      type: 'string',
      options: { list: seriesList },
    }),
    defineField({ name: 'manufacturer', title: 'Manufacturer', type: 'string' }),
    defineField({ name: 'year', title: 'Year', type: 'number' }),
    defineField({ name: 'scale', title: 'Scale', type: 'string' }),
    defineField({ name: 'condition', title: 'Condition', type: 'string' }),
    defineField({ name: 'barcode', title: 'Barcode', type: 'string' }),
    defineField({ name: 'externalImageUrl', title: 'External Image URL', type: 'url' }),
    defineField({
      name: 'needsInfo',
      title: 'Missing info',
      type: 'boolean',
      initialValue: false,
    }),
    ...sharedFields.map((f) => defineField(f as any)),
  ],
  preview: {
    select: {
      title: 'title',
      subtitle: 'series',
      category: 'category',
      image: 'image',
      externalImageUrl: 'externalImageUrl',
    },
    prepare({ title, subtitle, category, image, externalImageUrl }) {
      const catLabel = category ? category.charAt(0).toUpperCase() + category.slice(1) : ''
      return {
        title,
        subtitle: [catLabel, subtitle].filter(Boolean).join(' · '),
        // Prefer the uploaded Sanity image; fall back to the external URL preview.
        media: image
          ? image
          : () => ExternalImagePreview({ title, subtitle, externalImageUrl }),
      }
    },
  },
})