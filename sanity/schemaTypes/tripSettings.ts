import { defineType, defineField } from 'sanity'
import { peopleList } from './peopleList'

export const tripSettings = defineType({
  name: 'tripSettings',
  title: 'Trip Settings',
  type: 'document',
  icon: () => '⚙️',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'string', initialValue: 'Japan trip', description: 'Just a name for this settings document' }),
    defineField({ name: 'budgetNok', title: 'Budget (NOK)', type: 'number' }),
    defineField({ name: 'budgetYen', title: 'Budget (JPY)', type: 'number' }),
    defineField({ name: 'jpyToNokRate', title: 'JPY → NOK rate', type: 'number', initialValue: 0.060, description: 'e.g. 0.060 means 1 JPY = 0.060 NOK' }),
    defineField({
      name: 'childBudgets',
      title: 'Per-child budgets',
      type: 'array',
      description: 'Optional budget for each person on this trip. Fill in NOK, JPY, or both.',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'person', title: 'Person', type: 'string', options: { list: peopleList } },
            { name: 'budgetNok', title: 'Budget (NOK)', type: 'number' },
            { name: 'budgetYen', title: 'Budget (JPY)', type: 'number' },
          ],
          preview: {
            select: { title: 'person', nok: 'budgetNok', yen: 'budgetYen' },
            prepare({ title, nok, yen }) {
              const parts = []
              if (nok) parts.push(`${nok} kr`)
              if (yen) parts.push(`¥${yen}`)
              return { title: title || 'Unassigned', subtitle: parts.join(' · ') }
            },
          },
        },
      ],
    }),
  ],
  preview: {
    select: { title: 'label', children: 'childBudgets' },
    prepare({ title, children }) {
      const n = Array.isArray(children) ? children.length : 0
      return {
        title: title || 'Trip Settings',
        subtitle: n ? `${n} person budget${n === 1 ? '' : 's'}` : 'No per-person budgets',
      }
    },
  },
})