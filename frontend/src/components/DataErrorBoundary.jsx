import React from 'react'
import { appLogger } from '@/lib/logger'
import { ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

/**
 * DataErrorBoundary - Handles errors from async data loading
 * Shows partial UI with error message for failed data fetches
 * Used for pages with React Query, API calls, etc.
 */
export default class DataErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    // Only catch data-related errors, not render errors
    if (error?.message?.includes('fetch') || error?.message?.includes('API') || error?.message?.includes('query')) {
      return { hasError: true, error }
    }
    throw error
  }

  componentDidCatch(error, errorInfo) {
    appLogger.error('Data loading error', {
      page: this.props.pageName || 'Unknown',
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
    })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
    // Optionally refetch data
    if (this.props.onRetry) {
      this.props.onRetry()
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '400px',
          padding: '40px 24px',
          background: 'var(--bg-page)',
          borderRadius: '12px',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        }}>
          {/* Warning Icon */}
          <ExclamationTriangleIcon style={{
            width: '48px',
            height: '48px',
            color: '#f59e0b',
            marginBottom: '16px',
            opacity: 0.8,
          }} />

          {/* Title */}
          <h3 style={{
            fontSize: '16px',
            fontWeight: 700,
            marginBottom: '8px',
            textAlign: 'center',
          }}>
            Failed to load data
          </h3>

          {/* Description */}
          <p style={{
            fontSize: '13px',
            color: 'var(--text-secondary)',
            marginBottom: '20px',
            textAlign: 'center',
            maxWidth: '400px',
            lineHeight: '1.5',
          }}>
            {this.state.error?.message || 'Unable to fetch the requested data. Please check your connection and try again.'}
          </p>

          {/* Retry Button */}
          <button
            onClick={this.handleRetry}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.target.style.transform = 'translateY(-2px)'
              e.target.style.boxShadow = '0 6px 12px rgba(79, 70, 229, 0.3)'
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translateY(0)'
              e.target.style.boxShadow = 'none'
            }}
          >
            <ArrowPathIcon style={{ width: '14px', height: '14px' }} />
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
