// "New" means acquired within the last 30 days.
export function isNew(acquiredDate: string | undefined): boolean {
  if (!acquiredDate) return false
  const d = new Date(acquiredDate).getTime()
  if (isNaN(d)) return false
  const days = (Date.now() - d) / (1000 * 60 * 60 * 24)
  return days >= 0 && days <= 30
}
