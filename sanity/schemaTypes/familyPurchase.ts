import { defineType, defineField } from 'sanity'
import { peopleList } from './peopleList'

export const familyPurchase = defineType({
  name: 'familyPurchase',
  title: 'Family Purchase',
  type: 'document',
  icon: () => '🛍️',
  fields: [
    defineField({
      name: 'person',
      title: 'Person',
      type: 'string',
      options: { list: peopleList, layout: 'dropdown' },
      validation: (R) => R.required(),
    }),
    defineField({ name: 'name', title: 'Name', type: 'string', validation: (R) => R.required() }),
    defineField({
      name: 'trip',
      title: 'Trip',
      type: 'reference',
      to: [{ type: 'tripSettings' }],
      description: 'Pick the person first — only trips that have a budget for that person will show.',
      validation: (R) => R.required(),
      options: {
        filter: ({ document }: any) => {
          const person = document?.person
          if (!person) {
            // No person chosen yet → show nothing, to nudge picking person first.
            return { filter: 'false' }
          }
          return {
            filter: 'count(childBudgets[person == $person && (defined(budgetNok) || defined(budgetYen))]) > 0',
            params: { person },
          }
        },
      },
    }),
    defineField({ name: 'priceNok', title: 'Price (NOK)', type: 'number' }),
    defineField({ name: 'priceYen', title: 'Price (JPY)', type: 'number' }),
  ],
  preview: {
    select: { title: 'name', person: 'person', nok: 'priceNok', yen: 'priceYen' },
    prepare({ title, person, nok, yen }) {
      const parts = []
      if (yen) parts.push(`¥${yen}`)
      if (nok) parts.push(`${nok} kr`)
      return { title: title || 'Family purchase', subtitle: [person, parts.join(' · ')].filter(Boolean).join(' — ') }
    },
  },
})