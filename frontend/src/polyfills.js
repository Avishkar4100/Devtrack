const ensureMatchMedia = () => {
  const nativeMatchMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia.bind(window)
    : null

  const safeMatchMedia = (query) => {
    if (nativeMatchMedia) {
      try {
        const mql = nativeMatchMedia(query)
        if (mql) {
          if (typeof mql.addListener !== 'function') mql.addListener = () => {}
          if (typeof mql.removeListener !== 'function') mql.removeListener = () => {}
          if (typeof mql.addEventListener !== 'function') mql.addEventListener = () => {}
          if (typeof mql.removeEventListener !== 'function') mql.removeEventListener = () => {}
          return mql
        }
      } catch (_) {
        // Fall through to a minimal shim below.
      }
    }

    return {
      matches: false,
      media: String(query || ''),
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }
  }

  window.matchMedia = safeMatchMedia
  globalThis.matchMedia = safeMatchMedia
}

if (typeof window !== 'undefined') {
  ensureMatchMedia()
}

