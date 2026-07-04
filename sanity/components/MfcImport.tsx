import { useFormValue } from 'sanity'
import type { StringInputProps } from 'sanity'
import { Stack, Flex, Button } from '@sanity/ui'
import { SearchIcon } from '@sanity/icons'

export function MfcImport(props: StringInputProps) {
  const { value, renderDefault } = props
  const title = (useFormValue(['title']) as string) || ''

  const code = (value || '').toString().trim()
  const term = code || title.trim() // prefer barcode, fall back to name
  const open = (u: string) => () => window.open(u, '_blank', 'noopener')

  return (
    <Stack space={3}>
      {renderDefault(props)}
      {term && (
        <Flex gap={2} wrap="wrap">
          <Button
            text="Search MFC"
            mode="ghost"
            icon={SearchIcon}
            onClick={open(`https://mymerchcollection.net/?_tb=item&keywords=${encodeURIComponent(term)}`)}
          />
          <Button
            text="Google"
            mode="ghost"
            onClick={open(`https://www.google.com/search?q=${encodeURIComponent(term + ' merch')}`)}
          />
          <Button
            text="Google Images"
            mode="ghost"
            onClick={open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(term + ' merch')}`)}
          />
        </Flex>
      )}
    </Stack>
  )
}