import { defineType, defineField } from 'sanity'
import { sharedFields } from './shared'
import { ExternalImagePreview } from '../components/ExternalImagePreview'

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
      name: 'externalImageUrl',
      title: 'External Image URL',
      type: 'url',
    }),

    defineField({
  name: 'series',
  title: 'Series / Game',
  type: 'string',
  options: {
    list: [
      { title: 'Final Fantasy I', value: 'Final Fantasy I' },
      { title: 'Final Fantasy II', value: 'Final Fantasy II' },
      { title: 'Final Fantasy III', value: 'Final Fantasy III' },
      { title: 'Final Fantasy IV', value: 'Final Fantasy IV' },
      { title: 'Final Fantasy V', value: 'Final Fantasy V' },
      { title: 'Final Fantasy VI', value: 'Final Fantasy VI' },
      { title: 'Final Fantasy VII', value: 'Final Fantasy VII' },
      { title: 'Final Fantasy VII Remake', value: 'Final Fantasy VII Remake' },
      { title: 'Final Fantasy VII Rebirth', value: 'Final Fantasy VII Rebirth' },
      { title: 'Final Fantasy VIII', value: 'Final Fantasy VIII' },
      { title: 'Final Fantasy IX', value: 'Final Fantasy IX' },
      { title: 'Final Fantasy X', value: 'Final Fantasy X' },
      { title: 'Final Fantasy XI', value: 'Final Fantasy XI' },
      { title: 'Final Fantasy XII', value: 'Final Fantasy XII' },
      { title: 'Final Fantasy XIII', value: 'Final Fantasy XIII' },
      { title: 'Final Fantasy XIV', value: 'Final Fantasy XIV' },
      { title: 'Final Fantasy XV', value: 'Final Fantasy XV' },
      { title: 'Final Fantasy XVI', value: 'Final Fantasy XVI' },
      { title: 'Final Fantasy Tactics', value: 'Final Fantasy Tactics' },
      { title: 'Final Fantasy Crystal Chronicles', value: 'Final Fantasy Crystal Chronicles' },
      { title: 'Dissidia Final Fantasy', value: 'Dissidia Final Fantasy' },
      { title: 'Theatrhythm Final Fantasy', value: 'Theatrhythm Final Fantasy' },
      { title: 'Chocobo', value: 'Chocobo' },
      { title: 'The Black Mages', value: 'The Black Mages' },
      { title: 'Distant Worlds', value: 'Distant Worlds' },
      { title: 'Piano Collections', value: 'Piano Collections' },
      { title: 'BRA★BRA Final Fantasy', value: 'BRA★BRA Final Fantasy' },
      { title: 'Other', value: 'Other' },
    ],
  },
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
  name: 'publisher',
  title: 'Publisher',
  type: 'string',
}),

defineField({
  name: 'distributor',
  title: 'Distributor',
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
