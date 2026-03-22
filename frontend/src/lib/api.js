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
    appLogger.error('API response error', {
      method: error.config?.method,
      url: error.config?.url,
      status: error.response?.status,
      message,
    })

    if (error.response?.status === 401) {
      useAuthStore.getState().logout()
      return Promise.reject(error)
    }

    if (error.response?.status !== 404) {
      toast.error(message)
    }

    return Promise.reject(error)
  }
)

export default api
