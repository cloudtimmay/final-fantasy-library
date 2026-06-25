import { useState } from 'react'
import { useClient } from 'sanity'
import type { DocumentActionComponent, DocumentActionProps } from 'sanity'
import { Stack, Select, Button, Text, useToast } from '@sanity/ui'
import { TransferIcon } from '@sanity/icons'

const TARGETS = [
  { value: 'album', title: 'Album' },
  { value: 'game', title: 'Game' },
  { value: 'figure', title: 'Figure' },
  { value: 'book', title: 'Book' },
]

export const transferToCollection: DocumentActionComponent = (props: DocumentActionProps) => {
  const { draft, published } = props
  const doc: any = draft || published
  const client = useClient({ apiVersion: '2024-01-01' })
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState('album')
  const [busy, setBusy] = useState(false)

  return {
    label: 'Transfer to collection',
    icon: TransferIcon,
    disabled: !doc?.name,
    title: doc?.name ? 'Create a collection item from this purchase' : 'Add a name first',
    onHandle: () => setOpen(true),
    dialog: open && {
      type: 'dialog',
      header: 'Transfer to collection',
      onClose: () => setOpen(false),
      content: (
        <Stack space={4}>
          <Text size={1} muted>
            Creates a new draft in the chosen collection, copying name, prices and date.
            Open the draft afterwards to add a cover image and publish.
          </Text>
          <Select value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
            {TARGETS.map((t) => (
              <option key={t.value} value={t.value}>{t.title}</option>
            ))}
          </Select>
          <Button
            text={busy ? 'Transferring…' : 'Transfer'}
            tone="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const newDoc: any = {
                  _id: `drafts.${crypto.randomUUID()}`,
                  _type: target,
                  title: doc.name,
                  status: 'owned',
                }
                if (doc.priceNok != null) newDoc.purchasePrice = doc.priceNok
                if (doc.priceYen != null) newDoc.purchasePriceYen = doc.priceYen
                if (doc.purchaseDate) newDoc.acquiredDate = doc.purchaseDate

                await client.create(newDoc)
                toast.push({
                  status: 'success',
                  title: `Draft ${target} created`,
                  description: `Open the ${target} list to add a cover and publish.`,
                })
                setOpen(false)
              } catch (err: any) {
                toast.push({
                  status: 'error',
                  title: 'Transfer failed',
                  description: String(err?.message || err),
                })
              } finally {
                setBusy(false)
              }
            }}
          />
        </Stack>
      ),
    },
  }
}