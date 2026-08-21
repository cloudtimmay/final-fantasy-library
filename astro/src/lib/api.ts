export function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

// Returns the parsed JSON body, or null if the request body could not be parsed as JSON.
// Endpoints always send objects, so callers can safely treat a null return as "bad request".
export async function parseJsonBody(request: Request): Promise<any | null> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const toNum = (v: any) => (v === '' || v == null || isNaN(Number(v)) ? undefined : Number(v))
const toStr = (v: any) => { const s = String(v ?? '').trim(); return s || undefined }

export type BuildDocField = {
  // Key to read from the request body.
  from: string
  // Key(s) to write on the document. Defaults to `from` (same name on both sides).
  to?: string | string[]
  // 'str' (default) trims to a non-empty string, or 'num' coerces to a finite number.
  type?: 'str' | 'num'
}

// Builds a Sanity document from `base` plus whichever optional `fields` are present
// (and valid) on `body`. A field is skipped entirely if its value is missing/blank/NaN.
export function buildDoc(base: Record<string, any>, body: any, fields: BuildDocField[]): Record<string, any> {
  const doc: Record<string, any> = { ...base }
  for (const field of fields) {
    const raw = body[field.from]
    const val = field.type === 'num' ? toNum(raw) : toStr(raw)
    if (val == null) continue
    const targets = Array.isArray(field.to) ? field.to : [field.to ?? field.from]
    for (const key of targets) doc[key] = val
  }
  return doc
}
