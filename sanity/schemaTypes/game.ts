import { defineType, defineField } from 'sanity'
import { sharedFields } from './shared'

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
    defineField({
      name: 'platform',
      title: 'Platform(s)',
      type: 'array',
      of: [{ type: 'string' }],
      options: {
        list: ['PC', 'PlayStation 5', 'PlayStation 4', 'Xbox Series X', 'Xbox One',
          'Nintendo Switch', 'Game Boy', 'SNES', 'Mega Drive', 'Other'],
        layout: 'tags',
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
    select: { title: 'title', subtitle: 'platform' },
    prepare({ title, subtitle }) {
      const platforms = Array.isArray(subtitle) ? subtitle.join(', ') : subtitle
      return { title, subtitle: platforms }
    },
  },
})
