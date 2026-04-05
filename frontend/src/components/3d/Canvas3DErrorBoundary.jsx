import React, { Suspense, useState, useEffect } from 'react'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, errorMessage: '' }
  }

  static getDerivedStateFromError(error) {
    return { 
      hasError: true, 
      errorMessage: error?.message || 'WebGL initialization failed'
    }
  }

  componentDidCatch(error, errorInfo) {
    console.error('3D Component Error:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-surface-2 to-surface-3 flex items-center justify-center rounded-lg border border-border-1">
          <div className="text-center px-4">
            <div className="text-lg font-mono text-neon-cyan mb-2">⚠️</div>
            <p className="text-sm font-medium text-gray-300">3D Unavailable</p>
            <p className="text-xs text-gray-500 mt-2">WebGL not supported</p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function FallbackUI() {
  return (
    <div className="w-full h-full bg-gradient-to-br from-surface-2 to-surface-3 flex items-center justify-center rounded-lg border border-border-1">
      <div className="text-center">
        <div className="inline-block animate-spin mb-3">
          <div className="w-6 h-6 border-2 border-neon-cyan border-t-neon-magenta rounded-full"></div>
        </div>
        <p className="text-sm text-gray-400">Loading 3D...</p>
      </div>
    </div>
  )
}

export default function Canvas3DErrorBoundary({ children, fallback = <FallbackUI /> }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Prevent server-side rendering and WebGL issues
  if (!mounted) {
    return fallback
  }

  return (
    <Suspense fallback={fallback}>
      <ErrorBoundary>{children}</ErrorBoundary>
    </Suspense>
  )
}
