const prefix = '[DevTrack FE]'

const isDev = import.meta.env.DEV

const print = (level, message, meta) => {
  const payload = meta === undefined ? [prefix, message] : [prefix, message, meta]
  if (level === 'debug' || level === 'info') {
    if (!isDev) return
  }
  // eslint-disable-next-line no-console
  console[level](...payload)
}

export const appLogger = {
  debug: (message, meta) => print('debug', message, meta),
  info: (message, meta) => print('info', message, meta),
  warn: (message, meta) => print('warn', message, meta),
  error: (message, meta) => print('error', message, meta),
}
