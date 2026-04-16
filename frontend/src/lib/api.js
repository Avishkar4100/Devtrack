import axios from 'axios'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { useNotificationStore } from '@/store/notificationStore'
import { appLogger } from '@/lib/logger'
import { extractApiErrorMessage, normalizeErrorMessageForDedupe } from '@/lib/errorUtils'

const shownApiWarnings = new Set()

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor — attach token
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token
    if (token) config.headers.Authorization = `Bearer ${token}`
    appLogger.debug('API request', {
      method: config.method,
      url: config.url,
      hasAuth: Boolean(token),
    })
    return config
  },
  (error) => {
    appLogger.error('API request setup failed', { message: error.message })
    return Promise.reject(error)
  }
)

// Response interceptor — handle errors
api.interceptors.response.use(
  (response) => {
    appLogger.debug('API response', {
      method: response.config?.method,
      url: response.config?.url,
      status: response.status,
    })
    return response
  },
  (error) => {
    const message = extractApiErrorMessage(error, 'Something went wrong')
    const dedupeMessage = normalizeErrorMessageForDedupe(message)
    const status = error.response?.status
    const normalizedMessage = String(message || '').toLowerCase()
    const method = (error.config?.method || 'GET').toUpperCase()
    const url = error.config?.url || 'unknown-endpoint'
    const addNotification = useNotificationStore.getState().addNotification

    if (error.response?.data && typeof error.response.data === 'object') {
      error.response.data.message = message
    }

    error.userMessage = message
    error.message = message
    error.__handledByApi = true

    const isAuthSessionFailure =
      status === 401 && (
        normalizedMessage.includes('not authorized') ||
        normalizedMessage.includes('invalid token') ||
        normalizedMessage.includes('token has expired') ||
        normalizedMessage.includes('user not found') ||
        normalizedMessage.includes('account has been deactivated')
      )

    appLogger.error('API response error', {
      method: error.config?.method,
      url: error.config?.url,
      status,
      message,
    })

    // Do not log out for Jira upstream 401s; only log out when app session auth is invalid.
    if (isAuthSessionFailure) {
      useAuthStore.getState().logout()
      return Promise.reject(error)
    }

    const isJiraCredsMissing = dedupeMessage.toLowerCase().includes('jira credentials not configured')
    const isGithubTokenMissing = dedupeMessage.toLowerCase().includes('github token not configured')

    if (isJiraCredsMissing) {
      const onceKey = 'jira-credentials-not-configured'
      if (!shownApiWarnings.has(onceKey)) {
        shownApiWarnings.add(onceKey)
        addNotification({
          sourceId: `api-${Date.now()}`,
          type: 'warning',
          message: dedupeMessage,
          dedupeKey: onceKey,
        })
      }
      return Promise.reject(error)
    }

    if (isGithubTokenMissing) {
      const onceKey = 'github-token-not-configured'
      if (!shownApiWarnings.has(onceKey)) {
        shownApiWarnings.add(onceKey)
        addNotification({
          sourceId: `api-${Date.now()}`,
          type: 'warning',
          message: dedupeMessage,
          dedupeKey: onceKey,
        })
      }
      return Promise.reject(error)
    }

    const shouldToast = status !== 404
    if (shouldToast) {
      toast.error(dedupeMessage || message, { id: `api|${method}|${url}|${dedupeMessage}` })
    } else {
      // Keep 404s visible in notification center even when toasts are suppressed.
      addNotification({
        sourceId: `api-${Date.now()}`,
        type: 'error',
        message,
        dedupeKey: `api|${method}|${url}|${status || 'NA'}|${dedupeMessage}`,
      })
    }

    return Promise.reject(error)
  }
)

export default api
