import { defineType, defineField } from 'sanity'
import { peopleList } from './peopleList'

// Something a family member (not Kim, who gets a full collection item instead — see
// add-item.astro) already owns, logged just well enough to avoid buying it again:
// no condition/price/shop history like priceEntry, just who has it and how to recognize it.
export const familyItem = defineType({
  name: 'familyItem',
  title: 'Family Item',
  type: 'document',
  icon: () => '🎁',
  fields: [
    defineField({
      name: 'person',
      title: 'Person',
      type: 'string',
      options: { list: peopleList, layout: 'dropdown' },
      validation: (R) => R.required(),
    }),
    defineField({ name: 'name', title: 'Name', type: 'string', validation: (R) => R.required() }),
    defineField({ name: 'nameJp', title: 'Name (Japanese)', type: 'string' }),
    defineField({
      name: 'jan',
      title: 'JAN / barcode',
      type: 'string',
      validation: (R) =>
        R.regex(/^(\d{8}|\d{12}|\d{13})$/, { name: 'JAN/EAN/UPC' }).warning('Expected 8, 12 or 13 digits'),
    }),
    defineField({
      name: 'category',
      title: 'Category',
      type: 'string',
      options: {
        list: [
          { title: 'Album', value: 'album' },
          { title: 'Game', value: 'game' },
          { title: 'Book', value: 'book' },
          { title: 'Merchandise', value: 'figure' },
          { title: 'Other', value: 'other' },
        ],
      },
    }),
    defineField({
      name: 'image',
      title: 'Photo',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({ name: 'note', title: 'Note', type: 'text', rows: 3 }),
  ],
  preview: {
    select: { title: 'name', person: 'person', category: 'category', image: 'image' },
    prepare({ title, person, category, image }) {
      const catLabel = category ? category.charAt(0).toUpperCase() + category.slice(1) : ''
      return {
        title: title || 'Unnamed item',
        subtitle: [person, catLabel].filter(Boolean).join(' · '),
        media: image || (() => '🎁'),
      }
    },
  },
})
