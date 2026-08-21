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
