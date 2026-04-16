const asText = (value) => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

const fromDetailArray = (detail = []) => {
  if (!Array.isArray(detail)) return ''

  const parts = detail
    .map((item) => {
      if (!item) return ''
      if (typeof item === 'string') return item
      if (typeof item === 'object') {
        const msg = asText(item.msg || item.message)
        const loc = Array.isArray(item.loc) ? item.loc.filter(Boolean).join('.') : ''
        if (msg && loc) return `${loc}: ${msg}`
        return msg
      }
      return ''
    })
    .filter(Boolean)

  return parts.join(', ')
}

const fromErrorArray = (errors = []) => {
  if (!Array.isArray(errors)) return ''
  return errors
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') return asText(item.message || item.msg)
      return ''
    })
    .filter(Boolean)
    .join(', ')
}

const sanitizeMessage = (message, fallback) => {
  const raw = asText(message)
  if (!raw) return fallback

  if (/Cannot read properties of null \(reading '_id'\)/i.test(raw)) {
    return 'A related record is missing (owner, member, or project link). Refresh and retry.'
  }

  if (/^Request failed with status code \d+$/i.test(raw)) {
    return fallback
  }

  return raw
}

export const normalizeErrorMessageForDedupe = (message = '') => {
  const text = asText(message)
  if (!text) return ''
  return text
    .replace(/\s*\(ref:\s*[a-f0-9-]{8,}\)\s*$/i, '')
    .trim()
}

export const extractApiErrorMessage = (error, fallback = 'Something went wrong') => {
  const responseData = error?.response?.data || {}
  const requestId = asText(responseData.requestId)

  const withRequestId = (message) => {
    const base = sanitizeMessage(message, fallback)
    return requestId ? `${base} (ref: ${requestId})` : base
  }

  const messageFromErrors = fromErrorArray(responseData.errors)
  if (messageFromErrors) return withRequestId(messageFromErrors)

  const detail = responseData.detail
  if (typeof detail === 'string' && detail.trim()) {
    return withRequestId(detail)
  }

  const detailFromArray = fromDetailArray(detail)
  if (detailFromArray) return withRequestId(detailFromArray)

  const message = asText(responseData.message || responseData.error || error?.userMessage || error?.message)
  return withRequestId(message)
}
