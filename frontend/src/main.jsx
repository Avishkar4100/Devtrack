import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import toast from 'react-hot-toast'
import './index.css'
import './polyfills.js'
import ThemeSync from './components/ThemeSync.jsx'
import NotificationSync from './components/NotificationSync.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import { appLogger } from './lib/logger'
import { useNotificationStore } from './store/notificationStore'

const notifyGlobalError = (message, source = 'browser') => {
  const text = typeof message === 'string' && message.trim()
    ? message.trim()
    : 'Unexpected runtime error occurred'
  useNotificationStore.getState().addNotification({
    sourceId: `${source}-${Date.now()}`,
    type: 'error',
    message: text,
    dedupeKey: `${source}|${text}`,
  })
  toast.error(text)
}

window.addEventListener('error', (event) => {
  const message = event?.error?.message || event?.message || 'Unexpected runtime error occurred'
  appLogger.error('Unhandled browser error', {
    message,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
  })
  notifyGlobalError(message, 'window-error')
})

window.addEventListener('unhandledrejection', (event) => {
  if (event?.reason?.__handledByApi) {
    return
  }
  const reason = event.reason?.message || event.reason || 'Unhandled async error'
  appLogger.error('Unhandled promise rejection', {
    reason,
  })
  notifyGlobalError(String(reason), 'window-rejection')
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      retry: 1,
    },
  },
})

const root = ReactDOM.createRoot(document.getElementById('root'))

const renderApp = async () => {
  const { default: App } = await import('./App.jsx')

  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <ThemeSync />
            <NotificationSync />
            <App />
            <Toaster
              position="top-right"
              toastOptions={{
                style: {
                  background: '#ffffff',
                  color: '#111827',
                  border: '1px solid #e5e7eb',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                },
                success: { iconTheme: { primary: '#10b981', secondary: '#ffffff' } },
                error: { iconTheme: { primary: '#ef4444', secondary: '#ffffff' } },
              }}
            />
          </BrowserRouter>
        </QueryClientProvider>
      </AppErrorBoundary>
    </React.StrictMode>
  )
}

renderApp().catch((error) => {
  appLogger.error('Failed to bootstrap app', { error: error?.message || String(error) })
  notifyGlobalError(error?.message || 'Failed to bootstrap application', 'bootstrap')
})
