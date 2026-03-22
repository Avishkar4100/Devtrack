import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await api.post('/auth/admin-login', form)
      setAuth(data.user, data.token)
      toast.success(`Admin login successful: ${data.user.name}`)
      navigate('/admin/overview')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Admin login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg-page)' }}>
      <div className="card p-6 w-full max-w-md space-y-4">
        <h1 className="text-2xl font-bold text-gray-100">Admin Login</h1>
        <p className="text-sm text-slate-400">Secure access to AI config and platform controls.</p>

        <form className="space-y-3" onSubmit={onSubmit}>
          <input className="input" type="email" placeholder="Admin Email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} required />
          <input className="input" type="password" placeholder="Password" value={form.password} onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))} required />
          <button className="btn-primary w-full" type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Sign in as Admin'}</button>
        </form>

        <Link to="/login" className="text-sm text-indigo-300 hover:text-indigo-200">Back to user login</Link>
      </div>
    </div>
  )
}
