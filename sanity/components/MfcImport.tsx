import { useState } from 'react'
import { useFormValue, useClient, type StringInputProps } from 'sanity'
import { Stack, Flex, Button, TextInput, useToast } from '@sanity/ui'
import { SearchIcon, DownloadIcon } from '@sanity/icons'

// Where the Astro endpoint lives. Update if your domain changes.
const LOOKUP_BASE = 'https://final-fantasy-library.vercel.app/api/mfc-lookup'

export function MfcImport(props: StringInputProps) {
  const { value, renderDefault } = props
  const docId = (useFormValue(['_id']) as string) || ''
  const title = (useFormValue(['title']) as string) || ''
  const client = useClient({ apiVersion: '2024-01-01' })
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')

  const code = (value || '').toString().trim()
  // Search term: prefer the barcode, fall back to the title.
  const term = code || title.trim()
  const open = (u: string) => () => window.open(u, '_blank', 'noopener')

  async function run() {
    if (!url.trim() || !docId) return
    setBusy(true)
    try {
      const res = await fetch(`${LOOKUP_BASE}?url=${encodeURIComponent(url.trim())}`)
      const data = await res.json()
      if (!res.ok) {
        toast.push({ status: 'error', title: 'Lookup failed', description: data?.error || 'Unknown error' })
        return
      }

      const fields: Record<string, any> = {}
      if (data.title) fields.title = data.title
      if (data.series) fields.series = data.series
      if (data.manufacturer) fields.manufacturer = data.manufacturer
      if (data.year) fields.year = data.year
      if (data.externalImageUrl) fields.externalImageUrl = data.externalImageUrl

      // Patch the draft so you can review before publishing.
      const draftId = docId.startsWith('drafts.') ? docId : `drafts.${docId}`
      await client.patch(draftId).set(fields).commit({ autoGenerateArrayKeys: true })

      toast.push({ status: 'success', title: 'Imported from MFC', description: data.title })
    } catch (e: any) {
      toast.push({ status: 'error', title: 'Lookup failed', description: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack space={3}>
      {renderDefault(props)}

      {/* Step 1: find the figure on MFC (searches barcode, or title if no barcode) */}
      {term && (
        <Flex gap={2} wrap="wrap">
          <Button
            text="Find on MFC"
            mode="ghost"
            icon={SearchIcon}
            onClick={open(`https://www.google.com/search?q=${encodeURIComponent('site:myfigurecollection.net ' + term)}`)}
          />
          <Button
            text="MFC search page"
            mode="ghost"
            onClick={open('https://myfigurecollection.net/browse/search/')}
          />
          <Button
            text="Google"
            mode="ghost"
            onClick={open(`https://www.google.com/search?q=${encodeURIComponent(term + ' figure')}`)}
          />
        </Flex>
      )}

      {/* Step 2: paste the item URL and auto-fill */}
      <Flex gap={2} align="center" wrap="wrap">
        <TextInput
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          placeholder="Paste MFC item URL (…/item/1457)"
          style={{ flex: 1, minWidth: 200 }}
        />
        <Button
          text={busy ? 'Importing…' : 'Import from MFC'}
          tone="primary"
          icon={DownloadIcon}
          disabled={busy}
          onClick={run}
        />
      </Flex>
    </Stack>
  )
}