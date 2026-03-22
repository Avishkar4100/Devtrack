import { useState, useRef, useEffect } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { BoltIcon, EnvelopeIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '@/store/authStore'
import api from '@/lib/api'
import toast from 'react-hot-toast'

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const email = searchParams.get('email') || ''
  const devOTP = searchParams.get('devOTP') || ''

  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [countdown, setCountdown] = useState(60)
  const inputRefs = useRef([])
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  // Auto-fill dev OTP
  useEffect(() => {
    if (devOTP && devOTP.length === 6) {
      setOtp(devOTP.split(''))
    }
  }, [devOTP])

  const handleChange = (i, val) => {
    if (!/^\d*$/.test(val)) return
    const next = [...otp]
    next[i] = val.slice(-1)
    setOtp(next)
    if (val && i < 5) inputRefs.current[i + 1]?.focus()
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) {
      inputRefs.current[i - 1]?.focus()
    }
  }

  const handlePaste = (e) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (text.length === 6) {
      setOtp(text.split(''))
      inputRefs.current[5]?.focus()
    }
  }

  const handleVerify = async () => {
    const code = otp.join('')
    if (code.length !== 6) return toast.error('Enter the full 6-digit code')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/verify-email', { email, otp: code })
      if (data.success && data.token) {
        setAuth(data.user, data.token)
        toast.success('Email verified! Welcome to DevTrack 🎉')
        navigate('/overview')
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid code. Please try again.')
      setOtp(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    try {
      const { data } = await api.post('/auth/resend-otp', { email })
      toast.success('New code sent to your email!')
      setCountdown(60)
      setOtp(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
      if (data.devOTP) {
        toast(`Dev mode — OTP: ${data.devOTP}`, { icon: '🛠️', duration: 10000 })
        setOtp(data.devOTP.split(''))
      }
    } catch {
      toast.error('Failed to resend. Try again.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f5f7fa' }}>
      <div className="w-full max-w-md px-4">
        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Header strip */}
          <div className="px-8 pt-8 pb-6 border-b border-gray-50 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
                 style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
              <EnvelopeIcon className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Check your email</h1>
            <p className="mt-2 text-sm text-gray-500">
              We sent a 6-digit code to<br />
              <span className="font-semibold text-gray-700">{email}</span>
            </p>
          </div>

          <div className="px-8 py-7">
            {devOTP && (
              <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 text-center">
                🛠️ Dev mode — email not sent. Code pre-filled: <strong>{devOTP}</strong>
              </div>
            )}

            {/* OTP inputs */}
            <div className="flex gap-3 justify-center mb-6" onPaste={handlePaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => inputRefs.current[i] = el}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleChange(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  className="w-12 h-14 text-center text-2xl font-bold rounded-xl border-2 outline-none transition-all"
                  style={{
                    borderColor: digit ? '#4f46e5' : '#e5e7eb',
                    background: digit ? '#f5f3ff' : '#fff',
                    color: '#111827',
                  }}
                />
              ))}
            </div>

            <button
              onClick={handleVerify}
              disabled={loading || otp.join('').length !== 6}
              className="btn-primary w-full btn-lg"
            >
              {loading ? 'Verifying…' : 'Verify Email'}
            </button>

            <div className="mt-5 text-center">
              <p className="text-sm text-gray-500">Didn't receive the code?</p>
              {countdown > 0 ? (
                <p className="text-sm text-gray-400 mt-1">Resend in <span className="font-semibold text-gray-600">{countdown}s</span></p>
              ) : (
                <button
                  onClick={handleResend}
                  disabled={resending}
                  className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 mt-1"
                >
                  {resending ? 'Sending…' : 'Resend code'}
                </button>
              )}
            </div>

            <div className="mt-6 pt-5 border-t border-gray-100 text-center">
              <Link to="/login" className="text-sm text-gray-500 hover:text-gray-700">
                ← Back to login
              </Link>
            </div>
          </div>
        </div>

        {/* Logo */}
        <div className="mt-6 flex items-center justify-center gap-2">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center"
               style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
            <BoltIcon className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-gray-700">Dev<span className="text-indigo-600">Track</span></span>
        </div>
      </div>
    </div>
  )
}
