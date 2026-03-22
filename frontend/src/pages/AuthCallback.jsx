import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { BoltIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

const ERROR_MESSAGES = {
  github_not_configured: 'GitHub OAuth is not configured yet. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to your backend .env file.',
  google_not_configured: 'Google OAuth is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your backend .env file.',
  microsoft_not_configured: 'Microsoft OAuth is not configured yet. Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to your backend .env file.',
  github_auth_failed: 'GitHub sign-in failed. Please try again.',
  google_auth_failed: 'Google sign-in failed. Please try again.',
  microsoft_auth_failed: 'Microsoft sign-in failed. Please try again.',
  redirect_uri_mismatch: 'Google OAuth: Redirect URI mismatch. Add http://localhost:5000/api/auth/google/callback to Authorized redirect URIs in Google Cloud Console.',
  access_denied: 'Access was denied. Please try again and allow the required permissions.',
}

export default function AuthCallbackPage() {
  const [params] = useSearchParams()
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    const token = params.get('token')
    const userStr = params.get('user')
    const error = params.get('error')

    if (error) {
      toast.error(ERROR_MESSAGES[error] || `Authentication error: ${error}`, { duration: 6000 })
      navigate('/login', { replace: true })
      return
    }

    if (token && userStr) {
      try {
        const user = JSON.parse(decodeURIComponent(userStr))
        setAuth(user, token)
        toast.success(`Welcome, ${user.name}! 🎉`)
        navigate('/overview', { replace: true })
      } catch {
        toast.error('Authentication failed. Please try again.')
        navigate('/login', { replace: true })
      }
    } else {
      navigate('/login', { replace: true })
    }
  }, [params, setAuth, navigate])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: '#f5f7fa' }}>
      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
           style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
        <BoltIcon className="w-6 h-6 text-white" />
      </div>
      <p className="text-gray-500 text-sm flex items-center gap-2">
        <svg className="animate-spin w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/>
        </svg>
        Completing sign in…
      </p>
    </div>
  )
}
