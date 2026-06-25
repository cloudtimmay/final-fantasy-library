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
          if (!person) return { filter: 'false' }
          return {
            filter: 'count(childBudgets[person == $person && (defined(budgetNok) || defined(budgetYen))]) > 0',
            params: { person },
          }
        },
      },
    }),
    defineField({
      name: 'store',
      title: 'Store',
      type: 'reference',
      to: [{ type: 'shopNote' }],
      description: 'Pick a shop, or use "Create new" to add one. Used to track the ¥5,000/day tax-free threshold per store.',
    }),
    defineField({
      name: 'purchaseDate',
      title: 'Date',
      type: 'date',
      description: 'Day of purchase — tax-free is counted per store per day',
      initialValue: () => new Date().toISOString().split('T')[0],
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Planned', value: 'planned' },
          { title: 'Bought', value: 'bought' },
        ],
        layout: 'radio',
      },
      initialValue: 'planned',
    }),
    defineField({
      name: 'priceYen',
      title: 'Price (JPY)',
      type: 'number',
      description: 'Shelf price as shown (tax included)',
    }),
    defineField({ name: 'priceNok', title: 'Price (NOK)', type: 'number' }),
    defineField({
      name: 'barcode',
      title: 'Barcode',
      type: 'string',
      description: 'Scanned barcode (optional) — handy for receipts/reordering',
    }),
    defineField({
      name: 'photos',
      title: 'Receipt / price tag photos',
      type: 'array',
      of: [{ type: 'image', options: { hotspot: false } }],
      description: 'Snap the receipt or shelf price tag for reconciliation',
    }),
  ],
  preview: {
    select: { title: 'name', person: 'person', status: 'status', yen: 'priceYen', store: 'store.shopName', media: 'photos.0' },
    prepare({ title, person, status, yen, store, media }) {
      const tag = status === 'bought' ? '✅' : '🛒'
      const bits = [person, store, yen ? `¥${yen}` : ''].filter(Boolean)
      return { title: `${tag} ${title || 'Family purchase'}`, subtitle: bits.join(' · '), media }
    },
  },
})