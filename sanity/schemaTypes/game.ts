import { defineType, defineField } from 'sanity'
import { sharedFields } from './shared'
import { ExternalImagePreview } from '../components/ExternalImagePreview'

export const game = defineType({
  name: 'game',
  title: 'Game',
  type: 'document',
  icon: () => '🎮',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (R) => R.required() }),
    defineField({ name: 'developer', title: 'Developer', type: 'string' }),
    defineField({ name: 'publisher', title: 'Publisher', type: 'string' }),
    defineField({ name: 'year', title: 'Release year', type: 'number' }),
    defineField({ name: 'barcode', title: 'Barcode (EAN/UPC)', type: 'string' }),
    defineField({ name: 'needsInfo', title: 'Mangler info', type: 'boolean', initialValue: false }),
    defineField({ name: 'externalImageUrl', title: 'External Image URL', type: 'url' }),
    
    defineField({
      name: 'platform',
      title: 'Platform',
      type: 'string',
      options: {
        list: ['NES', 'SNES', 'PS1', 'PS2', 'PS3', 'PS4', 'PS5', 'PSP', 'PSVITA',
          'XBOX', 'PC', 'DS', '3DS', 'SWITCH', 'SWITCH2',
          'GAMECUBE', 'WII', 'WIIU'],
      },
    }),
    defineField({
      name: 'genre',
      title: 'Genre',
      type: 'string',
      options: {
        list: ['Action', 'RPG', 'Strategy', 'Simulation', 'Puzzle', 'Adventure',
          'Shooter', 'Sports', 'Fighting', 'Horror', 'Other'],
      },
    }),
    defineField({
      name: 'completionStatus',
      title: 'Completion',
      type: 'string',
      options: {
        list: [
          { title: 'Not started', value: 'backlog' },
          { title: 'Playing', value: 'playing' },
          { title: 'Completed', value: 'completed' },
          { title: 'Dropped', value: 'dropped' },
        ],
        layout: 'radio',
      },
    }),
    defineField({ name: 'playtimeHours', title: 'Playtime (hours)', type: 'number' }),
    ...sharedFields.map((f) => defineField(f as any)),
  ],
  preview: {
    select: {
      title: 'title',
      subtitle: 'platform',
      image: 'image',
      externalImageUrl: 'externalImageUrl',
    },
    prepare({ title, subtitle, image, externalImageUrl }) {
      const platforms = Array.isArray(subtitle) ? subtitle.join(', ') : subtitle
      return {
        title,
        subtitle: platforms,
        media: image
          ? image
          : () => ExternalImagePreview({ title, subtitle: platforms, externalImageUrl }),
      }
    },
  },
})