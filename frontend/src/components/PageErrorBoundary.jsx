import React from 'react'
import { appLogger } from '@/lib/logger'
import { XCircleIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

/**
 * PageErrorBoundary - Graceful error UI for individual pages
 * Shows error message with retry button without crashing the whole app
 */
export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo })
    appLogger.error('Page render error', {
      page: this.props.pageName || 'Unknown',
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
    })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
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
          <div className="card" style={{
            maxWidth: '600px',
            width: '100%',
            padding: '40px 32px',
            textAlign: 'center',
          }}>
            {/* Error Icon */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: '20px',
            }}>
              <XCircleIcon style={{
                width: '56px',
                height: '56px',
                color: '#ef4444',
                opacity: 0.8,
              }} />
            </div>

            {/* Heading */}
            <h2 style={{
              fontSize: '20px',
              fontWeight: 700,
              marginBottom: '8px',
              color: 'var(--text-primary)',
            }}>
              Oops! Something went wrong
            </h2>

            {/* Description */}
            <p style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              marginBottom: '20px',
              lineHeight: '1.6',
            }}>
              {this.props.pageName ? `The ${this.props.pageName} page encountered an error.` : 'This page encountered an error.'}
              {' '}We've logged the issue and our team will investigate.
            </p>

            {/* Error Details (in dev mode) */}
            {this.state.error && process.env.NODE_ENV === 'development' && (
              <details style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-input)',
                borderRadius: '10px',
                padding: '12px',
                marginBottom: '20px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                textAlign: 'left',
              }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: '8px' }}>
                  Error Details (Dev Mode)
                </summary>
                <pre style={{
                  maxHeight: '200px',
                  overflow: 'auto',
                  fontSize: '11px',
                  lineHeight: '1.4',
                  color: '#fca5a5',
                  width: '100%',
                  margin: 0,
                }}>
                  {this.state.error?.stack || this.state.error?.message || 'Unknown error'}
                </pre>
              </details>
            )}

            {/* Action Buttons */}
            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}>
              <button
                onClick={this.handleRetry}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'translateY(-2px)'
                  e.target.style.boxShadow = '0 8px 16px rgba(79, 70, 229, 0.3)'
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'translateY(0)'
                  e.target.style.boxShadow = 'none'
                }}
              >
                <ArrowPathIcon style={{ width: '16px', height: '16px' }} />
                Try Again
              </button>

              <button
                onClick={() => window.location.href = '/overview'}
                style={{
                  padding: '10px 20px',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-input)',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'var(--bg-hover)'
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'var(--bg-input)'
                }}
              >
                Go to Dashboard
              </button>
            </div>

            {/* Support Info */}
            <p style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginTop: '20px',
            }}>
              If this keeps happening, please <a
                href="mailto:support@devtrack.local"
                style={{ color: '#6366f1', textDecoration: 'none' }}
              >
                contact support
              </a>
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
