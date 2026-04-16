import { useEffect, useRef } from 'react'
import { useToasterStore } from 'react-hot-toast'
import { useNotificationStore } from '@/store/notificationStore'

const extractMessageText = (message) => {
  if (typeof message === 'string') return message
  if (typeof message === 'number') return String(message)
  return 'Notification received'
}

export default function NotificationSync() {
  const { toasts } = useToasterStore()
  const addNotification = useNotificationStore((state) => state.addNotification)
  const processedRef = useRef(new Set())

  useEffect(() => {
    toasts.forEach((toast) => {
      if (!toast?.visible) return
      if (toast.type === 'loading') return

      const message = extractMessageText(toast.message)
      const key = `${toast.type || 'blank'}|${message}`
      if (processedRef.current.has(key)) return

      if (processedRef.current.size > 500) {
        processedRef.current.clear()
      }

      processedRef.current.add(key)
      addNotification({
        sourceId: toast.id,
        type: toast.type || 'blank',
        message,
        dedupeKey: key,
      })
    })
  }, [toasts, addNotification])

  return null
}
