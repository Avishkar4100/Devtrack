import axios from 'axios'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { appLogger } from '@/lib/logger'

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
    const message = error.response?.data?.message || error.message || 'Something went wrong'
    const status = error.response?.status
    const normalizedMessage = String(message || '').toLowerCase()

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

    if (status !== 404) {
      toast.error(message)
    }

    return Promise.reject(error)
  }
)

export default api
