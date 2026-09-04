import { HttpError } from './security.mjs'
export const MAX_LIST_OFFSET = 100000
export function pageOffset(value) {
  if (value === undefined) return 0
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value))) throw new HttpError(400, 'A non-negative integer pagination offset is required.')
  const offset = Number(value)
  if (!Number.isSafeInteger(offset) || offset > MAX_LIST_OFFSET) throw new HttpError(400, 'Pagination limit reached. Narrow the requested dataset before continuing.')
  return offset
}
export function pageResult(offset, count, limit) {
  const hasFullPage = count === limit
  const capped = hasFullPage && offset + limit > MAX_LIST_OFFSET
  return { nextOffset: hasFullPage && !capped ? offset + limit : null, paginationLimited: capped }
}
