import { useEffect, useState, useCallback } from 'react'
import { connectSocket, disconnectSocket } from '@/lib/socket'
import toast from 'react-hot-toast'

/**
 * useProjectSocket - Listen to real-time WebSocket events for a project
 * 
 * Usage:
 *   const { events, isConnected } = useProjectSocket(projectId, {
 *     onStoryCreated: (story) => console.log('Story created:', story),
 *     onStoryUpdated: (story) => console.log('Story updated:', story),
 *   })
 */
export function useProjectSocket(projectId, callbacks = {}) {
  const [isConnected, setIsConnected] = useState(false)
  const [events, setEvents] = useState({
    storyCreated: null,
    storyUpdated: null,
    storyDeleted: null,
    storiesSaved: null,
    storyAssigned: null,
    sprintUpdated: null,
    notification: null,
  })

  const handleSocketEvent = useCallback((eventName, handler) => {
    return (data) => {
      setEvents((prev) => ({ ...prev, [eventName]: data }))
      if (handler) handler(data)
    }
  }, [])

  useEffect(() => {
    if (!projectId) return

    const socket = connectSocket(projectId)

    const onConnect = () => {
      setIsConnected(true)
      console.log('📡 Connected to project:', projectId)
    }

    const onDisconnect = () => {
      setIsConnected(false)
      console.log('📡 Disconnected from project:', projectId)
    }

    // Story events
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)

    socket.on('story:created', handleSocketEvent('storyCreated', callbacks.onStoryCreated))
    socket.on('story:updated', handleSocketEvent('storyUpdated', callbacks.onStoryUpdated))
    socket.on('story:deleted', handleSocketEvent('storyDeleted', callbacks.onStoryDeleted))
    socket.on('story:assigned', handleSocketEvent('storyAssigned', callbacks.onStoryAssigned))

    // Bulk events
    socket.on('stories:saved', handleSocketEvent('storiesSaved', callbacks.onStoriesSaved))

    // Sprint events
    socket.on('sprint:updated', handleSocketEvent('sprintUpdated', callbacks.onSprintUpdated))

    // Notifications
    socket.on('notification', (notification) => {
      const normalized = notification?.data && !notification?.message
        ? { ...notification.data, event: notification.event || 'notification', timestamp: notification.timestamp }
        : (notification || {})

      const notificationType = normalized.type || 'info'
      const notificationMessage = normalized.message || normalized.error || normalized.detail || 'Notification received'

      handleSocketEvent('notification', callbacks.onNotification)({
        ...normalized,
        type: notificationType,
        message: notificationMessage,
      })
      
      // Show toast based on notification type
      const toastConfig = {
        success: () => toast.success(notificationMessage),
        error: () => toast.error(notificationMessage),
        warning: () => toast((t) => (
          <div style={{ display: 'flex', gap: '8px' }}>
            <span>⚠️</span>
            <span>{notificationMessage}</span>
          </div>
        )),
        info: () => toast(notificationMessage),
      }
      
      if (toastConfig[notificationType]) {
        toastConfig[notificationType]()
      }
    })

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('story:created')
      socket.off('story:updated')
      socket.off('story:deleted')
      socket.off('story:assigned')
      socket.off('stories:saved')
      socket.off('sprint:updated')
      socket.off('notification')
      disconnectSocket(projectId)
    }
  }, [projectId, callbacks, handleSocketEvent])

  return { isConnected, events }
}

/**
 * useStoryUpdates - Simplified hook for tracking story changes
 * Refetches story data when updates are detected
 */
export function useStoryUpdates(projectId, onUpdate) {
  const { events: socketEvents, isConnected } = useProjectSocket(projectId, {
    onStoryCreated: () => onUpdate?.({ type: 'created' }),
    onStoryUpdated: () => onUpdate?.({ type: 'updated' }),
    onStoryDeleted: () => onUpdate?.({ type: 'deleted' }),
    onStoriesSaved: () => onUpdate?.({ type: 'bulk-saved' }),
  })

  return { socketEvents, isConnected }
}
