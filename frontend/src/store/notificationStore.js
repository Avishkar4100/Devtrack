import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_NOTIFICATIONS = 300

const typeToLabel = (type = 'blank') => {
  if (type === 'success') return 'Success'
  if (type === 'error') return 'Error'
  if (type === 'loading') return 'Loading'
  return 'Notification'
}

const normalizeMessage = (value) => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return 'Notification received'
}

const makeId = () => `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const useNotificationStore = create(
  persist(
    (set) => ({
      notifications: [],

      addNotification: ({ sourceId = '', type = 'blank', message = '', dedupeKey = '' }) => {
        const normalizedMessage = normalizeMessage(message)
        const key = dedupeKey || `${sourceId}|${type}|${normalizedMessage}`

        set((state) => {
          const exists = state.notifications.some((n) => n.dedupeKey === key)
          if (exists) return state

          const next = [
            {
              id: makeId(),
              sourceId,
              dedupeKey: key,
              type,
              title: typeToLabel(type),
              message: normalizedMessage,
              seen: false,
              createdAt: new Date().toISOString(),
            },
            ...state.notifications,
          ]

          return { notifications: next.slice(0, MAX_NOTIFICATIONS) }
        })
      },

      markSeen: (id) => set((state) => ({
        notifications: state.notifications.map((item) => item.id === id ? { ...item, seen: true } : item),
      })),

      markAllSeen: () => set((state) => ({
        notifications: state.notifications.map((item) => ({ ...item, seen: true })),
      })),

      removeNotification: (id) => set((state) => ({
        notifications: state.notifications.filter((item) => item.id !== id),
      })),

      clearNotifications: () => set({ notifications: [] }),
    }),
    {
      name: 'devtrack-notifications',
      partialize: (state) => ({ notifications: state.notifications }),
    }
  )
)
