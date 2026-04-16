import React from 'react'
import toast from 'react-hot-toast'
import { appLogger } from '@/lib/logger'
import { useNotificationStore } from '@/store/notificationStore'

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    const message = error?.message || 'UI crashed while rendering'
    appLogger.error('React render error', {
      message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
    })

    useNotificationStore.getState().addNotification({
      sourceId: `render-${Date.now()}`,
      type: 'error',
      message,
      dedupeKey: `render|${message}`,
    })

    toast.error(message)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-page)',
          color: 'var(--text-primary)',
          padding: '24px',
        }}>
          <div className="card" style={{ maxWidth: '760px', width: '100%', padding: '20px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>UI crashed while rendering</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>
              A runtime error occurred. Use the error below to identify the broken component.
            </p>
            <pre style={{
              margin: 0,
              maxHeight: '260px',
              overflow: 'auto',
              fontSize: '12px',
              lineHeight: 1.5,
              background: 'var(--bg-input)',
              border: '1px solid var(--border-input)',
              borderRadius: '10px',
              padding: '12px',
              color: '#fca5a5',
            }}>
              {this.state.error?.stack || this.state.error?.message || 'Unknown render error'}
            </pre>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button className="btn-primary" onClick={this.handleReload}>Reload app</button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
