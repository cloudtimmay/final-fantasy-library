import { defineType, defineField } from 'sanity'

export const priceEntry = defineType({
  name: 'priceEntry',
  title: 'Price Entry',
  type: 'document',
  icon: () => '🏷️',
  fieldsets: [
    { name: 'product', title: 'Product' },
    { name: 'source', title: 'Where' },
    { name: 'pricing', title: 'Price' },
  ],
  fields: [
    // ── Product ─────────────────────────────────────────────
    defineField({
      name: 'item',
      title: 'Library item',
      description: 'Link to an item already in the library. Leave empty for things you found in a shop and have not added yet.',
      type: 'reference',
      to: [{ type: 'album' }, { type: 'game' }, { type: 'book' }, { type: 'figure' }],
      weak: true,
      fieldset: 'product',
    }),
    defineField({
      name: 'productName',
      title: 'Product name',
      description: 'Required when no library item is linked.',
      type: 'string',
      fieldset: 'product',
      validation: (R) =>
        R.custom((value, ctx) => {
          const doc = ctx.document as { item?: unknown } | undefined
          return value || doc?.item ? true : 'Add a product name or link a library item'
        }),
    }),
    defineField({
      name: 'productNameJp',
      title: 'Product name (Japanese)',
      type: 'string',
      fieldset: 'product',
    }),
    defineField({
      name: 'jan',
      title: 'JAN / barcode',
      description: 'Used to match the same product across shops.',
      type: 'string',
      fieldset: 'product',
      validation: (R) =>
        R.regex(/^(\d{8}|\d{12}|\d{13})$/, { name: 'JAN/EAN/UPC' }).warning('Expected 8, 12 or 13 digits'),
    }),
    defineField({
      name: 'category',
      title: 'Category',
      type: 'string',
      fieldset: 'product',
      options: {
        list: [
          { title: 'Album', value: 'album' },
          { title: 'Game', value: 'game' },
          { title: 'Book', value: 'book' },
          { title: 'Merchandise', value: 'figure' },
          { title: 'Other', value: 'other' },
        ],
      },
      validation: (R) => R.required(),
    }),
    defineField({
      name: 'photo',
      title: 'Photo',
      type: 'image',
      options: { hotspot: true },
      fieldset: 'product',
    }),

    // ── Source ──────────────────────────────────────────────
    defineField({
      name: 'sourceType',
      title: 'Source',
      type: 'string',
      fieldset: 'source',
      options: {
        list: [
          { title: '🇯🇵 Shop in Japan', value: 'japanStore' },
          { title: '🌐 Online', value: 'online' },
          { title: '🇳🇴 Norway', value: 'norway' },
        ],
        layout: 'radio',
      },
      initialValue: 'japanStore',
      validation: (R) => R.required(),
    }),
    defineField({
      name: 'shop',
      title: 'Shop',
      type: 'reference',
      to: [{ type: 'shopNote' }],
      weak: true,
      fieldset: 'source',
      hidden: ({ document }) => document?.sourceType !== 'japanStore',
    }),
    defineField({
      name: 'sourceName',
      title: 'Store / site name',
      description: 'E.g. CDJapan, Amiami, Mercari, Outland.',
      type: 'string',
      fieldset: 'source',
      hidden: ({ document }) => document?.sourceType === 'japanStore',
    }),
    defineField({
      name: 'url',
      title: 'Link',
      type: 'url',
      fieldset: 'source',
      hidden: ({ document }) => document?.sourceType === 'japanStore',
    }),

    // ── Price ───────────────────────────────────────────────
    defineField({
      name: 'price',
      title: 'Price',
      type: 'number',
      fieldset: 'pricing',
      validation: (R) => R.required().min(0),
    }),
    defineField({
      name: 'currency',
      title: 'Currency',
      type: 'string',
      fieldset: 'pricing',
      options: { list: ['JPY', 'NOK', 'USD', 'EUR'], layout: 'radio', direction: 'horizontal' },
      initialValue: 'JPY',
      validation: (R) => R.required(),
    }),
    defineField({
      name: 'taxIncluded',
      title: 'Price includes consumption tax',
      description: 'Japanese tags often show the price before tax (税抜) with the full price (税込) in small print. Turn off if you entered the 税抜 price.',
      type: 'boolean',
      fieldset: 'pricing',
      initialValue: true,
    }),
    defineField({
      name: 'extraCost',
      title: 'Shipping / extra cost',
      description: 'Same currency as the price.',
      type: 'number',
      fieldset: 'pricing',
      validation: (R) => R.min(0),
    }),
    defineField({
      name: 'condition',
      title: 'Condition',
      type: 'string',
      fieldset: 'pricing',
      options: {
        list: [
          { title: 'New', value: 'new' },
          { title: 'Used', value: 'used' },
          { title: 'Used, complete (box/obi)', value: 'used_complete' },
        ],
        layout: 'radio',
      },
      initialValue: 'new',
    }),

    // ── Status ──────────────────────────────────────────────
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Considering', value: 'considering' },
          { title: 'Bought', value: 'bought' },
        ],
        layout: 'radio',
      },
      initialValue: 'considering',
    }),
    defineField({
      name: 'seenAt',
      title: 'Seen at',
      type: 'datetime',
      initialValue: () => new Date().toISOString(),
    }),
    defineField({ name: 'note', title: 'Note', type: 'text', rows: 3 }),
  ],
  preview: {
    select: {
      itemTitle: 'item.title',
      productName: 'productName',
      price: 'price',
      currency: 'currency',
      shopName: 'shop.shopName',
      sourceName: 'sourceName',
      status: 'status',
      photo: 'photo',
    },
    prepare({ itemTitle, productName, price, currency, shopName, sourceName, status, photo }) {
      const priceText = typeof price === 'number' ? `${price.toLocaleString('en-US')} ${currency || ''}`.trim() : ''
      return {
        title: itemTitle || productName || 'Unnamed product',
        subtitle: [status === 'bought' ? '✅' : '', priceText, shopName || sourceName].filter(Boolean).join(' · '),
        media: photo || (() => '🏷️'),
      }
    },
  },
})
