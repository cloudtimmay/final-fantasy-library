import { defineType, defineField } from 'sanity'

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
  ],
  preview: {
    select: { title: 'label', subtitle: 'budgetNok' },
    prepare({ title, subtitle }) {
      return { title: title || 'Trip Settings', subtitle: subtitle ? `Budget: ${subtitle} kr` : '' }
    },
  },
})