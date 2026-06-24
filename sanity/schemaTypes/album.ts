import { defineType, defineField } from 'sanity'
import { sharedFields } from './shared'
import { ExternalImagePreview } from '../components/ExternalImagePreview'
import { seriesList } from './seriesList'

export const album = defineType({
  name: 'album',
  title: 'Album',
  type: 'document',
  icon: () => '🎵',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (R) => R.required() }),
    defineField({
  name: 'series',
  title: 'Series / Franchise',
  type: 'string',
  options: {
        list: seriesList,
      },
}),
    defineField({ name: 'artist', title: 'Artist / Band', type: 'string' }),
    defineField({ name: 'composer', title: 'Composer(s)', type: 'string' }),
    defineField({ name: 'year', title: 'Release year', type: 'number' }),
    defineField({
      name: 'genre',
      title: 'Genre',
      type: 'string',
      options: {
        list: ['Soundtrack', 'Remix', 'Jazz', 'Orchestral', 'Other'],
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
    defineField({
  name: 'catalogNumber',
  title: 'Catalog Number',
  type: 'string',
}),

defineField({
  name: 'vgmdbId',
  title: 'VGMdb ID',
  type: 'string',
}),

defineField({
  name: 'vgmdbUrl',
  title: 'VGMdb URL',
  type: 'url',
}),
defineField({
  name: 'youtubeMusicUrl',
  title: 'YouTube Music URL',
  type: 'url',
}),
defineField({
  name: 'youtubePlaylistId',
  title: 'YouTube spilleliste/video (ID eller URL)',
  type: 'string',
}),
    defineField({
      name: 'externalImageUrl',
      title: 'External Image URL',
      type: 'url',
    }),

defineField({
  name: 'barcode',
  title: 'Barcode',
  type: 'string',
}),

defineField({
  name: 'releaseDate',
  title: 'Release Date',
  type: 'string',
}),

defineField({
  name: 'releasePrice',
  title: 'Release Price',
  type: 'string',
}),

defineField({
  name: 'tracklist',
  title: 'Tracklist',
  type: 'array',
  of: [
    {
      type: 'object',
      preview: {
        select: {
          disc: 'disc',
          trackNumber: 'trackNumber',
          title: 'title',
        },
        prepare({ disc, trackNumber, title }) {
          return {
            title: `${disc ? `Disc ${disc} - ` : ''}${trackNumber ? `${trackNumber}. ` : ''}${title || ''}`,
          }
        },
      },
      fields: [
        { name: 'disc', title: 'Disc', type: 'number' },
        { name: 'trackNumber', title: 'Track Number', type: 'string' },
        { name: 'title', title: 'Title', type: 'string' },
        { name: 'duration', title: 'Duration', type: 'string' },
        { name: 'youtubeId', title: 'YouTube ID eller URL', type: 'string' },
      ],
    },
  ],
}),
    ...sharedFields.map((f) => defineField(f as any)),
  ],
  preview: {
  select: {
    title: 'title',
    subtitle: 'artist',
    externalImageUrl: 'externalImageUrl',
  },
  prepare({ title, subtitle, externalImageUrl }) {
    return {
      title,
      subtitle,
      media: () =>
        ExternalImagePreview({
          title,
          subtitle,
          externalImageUrl,
        }),
    }
  },
},
})
