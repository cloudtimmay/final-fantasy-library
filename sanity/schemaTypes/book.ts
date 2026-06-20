import { defineType, defineField } from 'sanity'
import { sharedFields } from './shared'

export const book = defineType({
  name: 'book',
  title: 'Book',
  type: 'document',
  icon: () => '📚',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (R) => R.required() }),
    defineField({ name: 'author', title: 'Author(s)', type: 'string', validation: (R) => R.required() }),
    defineField({ name: 'year', title: 'Publication year', type: 'number' }),
    defineField({ name: 'publisher', title: 'Publisher', type: 'string' }),
    defineField({ name: 'isbn', title: 'ISBN', type: 'string' }),
    defineField({ name: 'pages', title: 'Pages', type: 'number' }),
    defineField({ name: 'externalImageUrl', title: 'External Image URL', type: 'url' }),
    defineField({
      name: 'genre',
      title: 'Genre',
      type: 'string',
      options: {
        list: ['Game Guide', 'Fiction', 'Non-fiction', 'Science Fiction', 'Fantasy', 'Mystery',
          'Biography', 'History', 'Science', 'Art', 'Comics / Manga', 'Other'],
      },
    }),
    defineField({
      name: 'language',
      title: 'Language',
      type: 'string',
      options: { list: ['English', 'Japanese'] },
    }),
    defineField({
      name: 'readStatus',
      title: 'Read status',
      type: 'string',
      options: {
        list: [
          { title: 'Unread', value: 'unread' },
          { title: 'Reading', value: 'reading' },
          { title: 'Read', value: 'read' },
          { title: 'DNF (did not finish)', value: 'dnf' },
        ],
        layout: 'radio',
      },
    }),
    defineField({ name: 'readDate', title: 'Date finished', type: 'date' }),
    ...sharedFields.map((f) => defineField(f as any)),
  ],
  preview: {
    select: { title: 'title', subtitle: 'author', externalImageUrl: 'externalImageUrl' },
  },
})