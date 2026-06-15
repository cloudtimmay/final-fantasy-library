import { defineType, defineField } from 'sanity'
import { sharedFields } from './shared'

export const album = defineType({
  name: 'album',
  title: 'Album',
  type: 'document',
  icon: () => '🎵',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (R) => R.required() }),
    defineField({ name: 'artist', title: 'Artist / Band', type: 'string', validation: (R) => R.required() }),
    defineField({ name: 'year', title: 'Release year', type: 'number' }),
    defineField({
      name: 'genre',
      title: 'Genre',
      type: 'string',
      options: {
        list: ['Rock', 'Metal', 'Jazz', 'Classical', 'Electronic', 'Pop', 'Hip-hop', 'Folk', 'Blues', 'Other'],
      },
    }),
    defineField({
      name: 'format',
      title: 'Format',
      type: 'string',
      options: {
        list: [
          { title: 'Vinyl (LP)', value: 'vinyl_lp' },
          { title: 'Vinyl (Single)', value: 'vinyl_single' },
          { title: 'CD', value: 'cd' },
          { title: 'Cassette', value: 'cassette' },
          { title: 'Digital', value: 'digital' },
        ],
        layout: 'radio',
      },
    }),
    defineField({ name: 'label', title: 'Record label', type: 'string' }),
    ...sharedFields.map((f) => defineField(f as any)),
  ],
  preview: {
    select: { title: 'title', subtitle: 'artist', media: 'image' },
    prepare({ title, subtitle }) {
      return { title, subtitle }
    },
  },
})
