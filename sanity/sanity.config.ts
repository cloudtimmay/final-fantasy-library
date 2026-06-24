import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { visionTool } from '@sanity/vision'
import { schemaTypes } from './schemaTypes'

export default defineConfig({
  name: 'collection-registry',
  title: 'My Collection',

  // Replace with your actual project ID after running `sanity init`
  projectId: 'ip4i779g',
  dataset: 'production',

  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Collection')
          .items([
            S.listItem().title('Albums').schemaType('album').child(S.documentTypeList('album')),
            S.listItem().title('Games').schemaType('game').child(S.documentTypeList('game')),
            S.listItem().title('Figures').schemaType('figure').child(S.documentTypeList('figure')),
            S.listItem().title('Books').schemaType('book').child(S.documentTypeList('book')),
            S.listItem().title('Shop Notes').schemaType('shopNote').child(S.documentTypeList('shopNote')),
            S.listItem().title('Trip Settings').schemaType('tripSettings').child(S.documentTypeList('tripSettings')),
          ]),
    }),
    visionTool(),
  ],

  schema: {
    types: schemaTypes,
  },
})
