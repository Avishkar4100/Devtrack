import { useState, useRef, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BoltIcon, EyeIcon, EyeSlashIcon, SunIcon, MoonIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '@/store/authStore'
import api from '@/lib/api'
import { appLogger } from '@/lib/logger'
import toast from 'react-hot-toast'
import { motion, AnimatePresence } from 'framer-motion'
import gsap from 'gsap'
import { useThemeStore } from '@/store/themeStore'

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.04.13 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/>
  </svg>
)
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
)

function NeuralCanvas({ isLight }) {
  const canvasRef = useRef(null)
  const isLightRef = useRef(isLight)
  useEffect(() => { isLightRef.current = isLight }, [isLight])
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let W, H, nodes, raf
    const mouse = { x: -999, y: -999 }
    const init = () => {
      W = canvas.width = window.innerWidth
      H = canvas.height = window.innerHeight
      nodes = Array.from({ length: Math.min(Math.floor(W / 14), 75) }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 1.8 + 0.6,
        hue: [Math.random() > 0.6 ? [99,102,241] : Math.random() > 0.5 ? [139,92,246] : [59,130,246]][0],
        a: Math.random() * 0.45 + 0.1,
      }))
    }
    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      const lm = isLightRef.current ? 4 : 1
      nodes.forEach((n, i) => {
        const mdx = n.x - mouse.x, mdy = n.y - mouse.y
        const md = Math.sqrt(mdx * mdx + mdy * mdy)
        if (md < 130) { n.vx += mdx / md * 0.025; n.vy += mdy / md * 0.025 }
        const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
        if (sp > 1.1) { n.vx *= 0.92; n.vy *= 0.92 }
        n.x += n.vx; n.y += n.vy
        if (n.x < 0 || n.x > W) n.vx *= -1
        if (n.y < 0 || n.y > H) n.vy *= -1
        for (let j = i + 1; j < nodes.length; j++) {
          const m = nodes[j], ex = n.x - m.x, ey = n.y - m.y, d = ex * ex + ey * ey
          if (d < 22000) {
            ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y)
            ctx.strokeStyle = `rgba(${n.hue[0]},${n.hue[1]},${n.hue[2]},${(1 - d / 22000) * 0.22 * lm})`
            ctx.lineWidth = isLightRef.current ? 1 : 0.65; ctx.stroke()
          }
        }
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r * (isLightRef.current ? 1.4 : 1), 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${n.hue[0]},${n.hue[1]},${n.hue[2]},${Math.min(n.a * lm, 0.9)})`
        ctx.fill()
      })
      raf = requestAnimationFrame(draw)
    }
    const onMouse = (e) => { mouse.x = e.clientX; mouse.y = e.clientY }
    init(); draw()
    window.addEventListener('resize', init)
    window.addEventListener('mousemove', onMouse)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', init); window.removeEventListener('mousemove', onMouse) }
  }, [])
  return <canvas ref={canvasRef} style={{ position:'fixed', top:0, left:0, width:'100%', height:'100%', pointerEvents:'none', zIndex:0, opacity: isLight ? 0.85 : 0.5 }} />
}

function MagBtn({ children, className, style, onClick, disabled, type = 'button' }) {
  const ref = useRef(null)
  const onMove = useCallback((e) => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    gsap.to(ref.current, { x:(e.clientX-r.left-r.width/2)*0.35, y:(e.clientY-r.top-r.height/2)*0.35, duration:0.4, ease:'power2.out' })
  }, [])
  const onLeave = useCallback(() => gsap.to(ref.current, { x:0, y:0, duration:0.6, ease:'elastic.out(1,0.5)' }), [])
  return (
    <motion.button ref={ref} type={type} className={className} style={style}
      onClick={onClick} disabled={disabled} onMouseMove={onMove} onMouseLeave={onLeave}
      whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
      transition={{ type:'spring', stiffness:400, damping:25 }}>
      {children}
    </motion.button>
  )
}

function AuthThemeToggle() {
  const { theme, toggleTheme } = useThemeStore()
  return (
    <motion.button onClick={toggleTheme} whileHover={{ scale:1.08 }} whileTap={{ scale:0.92 }}
      style={{ position:'fixed', top:'18px', right:'18px', zIndex:200, width:'36px', height:'36px', borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg-card)', border:'1px solid var(--border-card)', color:'var(--text-secondary)', cursor:'pointer', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', boxShadow:'0 4px 16px rgba(0,0,0,0.15)' }}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ rotate:-45, opacity:0, scale:0.6 }} animate={{ rotate:0, opacity:1, scale:1 }}
          exit={{ rotate:45, opacity:0, scale:0.6 }} transition={{ duration:0.2 }} style={{ display:'flex' }}>
          {theme === 'dark' ? <SunIcon style={{ width:'16px', height:'16px' }} /> : <MoonIcon style={{ width:'16px', height:'16px' }} />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )
}

const ROLES = [
  { value:'manager',      label:'Manager',      icon:'📋', sub:'Track delivery and risks' },
  { value:'scrum_master', label:'Scrum Master', icon:'🏃', sub:'Manage backlog and sprint flow' },
]

export default function RegisterPage() {
  const [form, setForm] = useState({ name:'', email:'', password:'', role:'manager' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState(null)
  const { setAuth } = useAuthStore()
  const { theme } = useThemeStore()
  const navigate = useNavigate()
  const isLight = theme === 'light'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return }
    setLoading(true)
    try {
      const { data } = await api.post('/auth/register', form)
      appLogger.info('Registration response received', {
        email: form.email,
        requiresVerification: data.requiresVerification,
      })

      if (data.requiresVerification) {
        const params = new URLSearchParams({ email: data.email || form.email })
        if (data.devOTP) params.set('devOTP', data.devOTP)
        toast.success(data.message || 'Account created. Verify your email to continue.')
        navigate(`/verify-email?${params.toString()}`)
        return
      }

      if (data.user && data.token) {
        setAuth(data.user, data.token)
        toast.success(`Welcome to DevTrack, ${data.user.name}!`)
        navigate('/overview')
        return
      }

      throw new Error('Unexpected register response from server')
    } catch (err) { toast.error(err.response?.data?.message || 'Registration failed') }
    finally { setLoading(false) }
  }

  const handleSocial = (provider) => {
    const base = import.meta.env.VITE_API_URL || 'http://localhost:5000'
    window.location.href = `${base}${provider === 'GitHub' ? '/api/auth/github' : '/api/auth/google'}`
  }

  const inputStyle = (field) => ({
    background: focusedField === field ? (isLight ? 'rgba(99,102,241,0.05)' : 'rgba(99,102,241,0.08)') : 'var(--bg-input)',
    border: focusedField === field ? '1px solid rgba(99,102,241,0.55)' : '1px solid var(--border-input)',
    boxShadow: focusedField === field ? '0 0 0 3px rgba(99,102,241,0.12), 0 0 24px rgba(99,102,241,0.1)' : 'none',
    transition:'all 0.25s ease',
  })

  const container = { hidden:{ opacity:0 }, show:{ opacity:1, transition:{ staggerChildren:0.07 } } }
  const item = { hidden:{ opacity:0, y:16 }, show:{ opacity:1, y:0, transition:{ duration:0.4, ease:[0.16,1,0.3,1] } } }

  return (
    <div style={{ minHeight:'100vh', overflowY:'auto', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg-page)', position:'relative' }}>
      <NeuralCanvas isLight={isLight} />
      <AuthThemeToggle />

      {/* Ambient orbs */}
      <motion.div style={{ position:'fixed', top:'-15%', right:'-8%', width:'600px', height:'600px', borderRadius:'50%', background:'radial-gradient(circle,rgba(139,92,246,0.14) 0%,transparent 70%)', filter:'blur(80px)', pointerEvents:'none', zIndex:1 }}
        animate={{ x:[0,-35,0], y:[0,20,0], scale:[1,1.07,1] }} transition={{ duration:11, repeat:Infinity, ease:'easeInOut' }} />
      <motion.div style={{ position:'fixed', bottom:'-15%', left:'-8%', width:'500px', height:'500px', borderRadius:'50%', background:'radial-gradient(circle,rgba(99,102,241,0.12) 0%,transparent 70%)', filter:'blur(80px)', pointerEvents:'none', zIndex:1 }}
        animate={{ x:[0,30,0], y:[0,-20,0], scale:[1,1.06,1] }} transition={{ duration:13, repeat:Infinity, ease:'easeInOut', delay:2.5 }} />

      {/* ── Centered form ── */}
      <div style={{ position:'relative', zIndex:2, width:'100%', maxWidth:'480px', padding:'24px 20px' }}>
        <motion.div style={{ width:'100%' }}
          variants={container} initial="hidden" animate="show">

          {/* Logo + back row */}
          <motion.div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }} variants={item}>
            <Link to="/" style={{ display:'flex', alignItems:'center', gap:'10px', textDecoration:'none' }}>
              <motion.div style={{ width:'36px', height:'36px', borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow:'0 4px 18px rgba(99,102,241,0.4)' }}
                animate={{ boxShadow:['0 4px 18px rgba(99,102,241,0.4)','0 4px 28px rgba(99,102,241,0.7)','0 4px 18px rgba(99,102,241,0.4)'] }}
                transition={{ duration:2.5, repeat:Infinity, ease:'easeInOut' }}>
                <BoltIcon style={{ width:'18px', height:'18px', color:'white' }} />
              </motion.div>
              <span style={{ fontWeight:800, fontSize:'16px', letterSpacing:'-0.03em', color:'var(--text-primary)' }}>Dev<span className="text-gradient">Track</span></span>
            </Link>
            <Link to="/" style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'12px', fontWeight:600, color:'var(--text-muted)', textDecoration:'none', padding:'6px 12px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--bg-card)', backdropFilter:'blur(8px)', transition:'all 0.2s' }}
              onMouseEnter={e=>{ e.currentTarget.style.color='#a5b4fc'; e.currentTarget.style.borderColor='rgba(99,102,241,0.35)' }}
              onMouseLeave={e=>{ e.currentTarget.style.color='var(--text-muted)'; e.currentTarget.style.borderColor='var(--border)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              Home
            </Link>
          </motion.div>

          {/* Glass card */}
          <motion.div style={{ background:'var(--bg-card)', border:'1px solid var(--border-card)', borderRadius:'24px', padding:'32px', backdropFilter:'blur(24px)', WebkitBackdropFilter:'blur(24px)', boxShadow: isLight ? '0 8px 40px rgba(0,0,0,0.1),0 1px 3px rgba(0,0,0,0.06)' : '0 8px 40px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.02)', position:'relative', overflow:'hidden' }}
            variants={item}>

            <div style={{ position:'absolute', top:0, left:'20%', right:'20%', height:'1px', background:'linear-gradient(90deg,transparent,rgba(139,92,246,0.55),rgba(99,102,241,0.4),transparent)', pointerEvents:'none' }} />
            <div style={{ position:'absolute', top:'-30px', right:'-30px', width:'80px', height:'80px', background:'radial-gradient(circle,rgba(139,92,246,0.15) 0%,transparent 70%)', pointerEvents:'none' }} />

            {/* Header */}
            <motion.div style={{ marginBottom:'22px' }} variants={item}>
              <h1 style={{ fontSize:'1.5rem', fontWeight:900, letterSpacing:'-0.04em', color:'var(--text-primary)', lineHeight:1.1, marginBottom:'5px' }}>Create your account</h1>
              <p style={{ fontSize:'13px', color:'var(--text-muted)' }}>Start building smarter with AI-powered dev tools</p>
            </motion.div>

            {/* Social buttons */}
            <motion.div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'16px' }} variants={item}>
              {[['GitHub', <GitHubIcon key="gh"/>], ['Google', <GoogleIcon key="go"/>]].map(([p, icon]) => (
                <motion.button key={p} onClick={() => handleSocial(p)}
                  whileHover={{ scale:1.03, y:-1 }} whileTap={{ scale:0.97 }}
                  style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', padding:'10px 0', borderRadius:'12px', fontSize:'13px', fontWeight:600, cursor:'pointer', background:'var(--bg-hover)', border:'1px solid var(--border-card)', color:'var(--text-primary)', transition:'border-color 0.2s,box-shadow 0.2s' }}
                  onMouseEnter={e=>{ e.currentTarget.style.borderColor='rgba(99,102,241,0.3)'; e.currentTarget.style.boxShadow='0 4px 12px rgba(99,102,241,0.1)' }}
                  onMouseLeave={e=>{ e.currentTarget.style.borderColor='var(--border-card)'; e.currentTarget.style.boxShadow='none' }}>
                  {icon}{p}
                </motion.button>
              ))}
            </motion.div>

            <motion.div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'16px' }} variants={item}>
              <div style={{ flex:1, height:'1px', background:'var(--border)' }} />
              <span style={{ fontSize:'11px', color:'var(--text-muted)', whiteSpace:'nowrap' }}>or with email</span>
              <div style={{ flex:1, height:'1px', background:'var(--border)' }} />
            </motion.div>

            <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
              <motion.div variants={item}>
                <label className="input-label">Full name</label>
                <input type="text" className="input" placeholder="Jane Doe"
                  value={form.name} onChange={e => setForm(p => ({ ...p, name:e.target.value }))}
                  onFocus={() => setFocusedField('name')} onBlur={() => setFocusedField(null)}
                  style={inputStyle('name')} required />
              </motion.div>

              <motion.div variants={item}>
                <label className="input-label">Email address</label>
                <input type="email" className="input" placeholder="you@company.com"
                  value={form.email} onChange={e => setForm(p => ({ ...p, email:e.target.value }))}
                  onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)}
                  style={inputStyle('email')} required />
              </motion.div>

              <motion.div variants={item}>
                <label className="input-label">Password</label>
                <div style={{ position:'relative' }}>
                  <input type={showPw ? 'text' : 'password'} className="input pr-10" placeholder="At least 6 characters"
                    value={form.password} onChange={e => setForm(p => ({ ...p, password:e.target.value }))}
                    onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)}
                    style={inputStyle('password')} required />
                  <button type="button" onClick={() => setShowPw(!showPw)}
                    style={{ position:'absolute', right:'12px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)' }}>
                    {showPw ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                  </button>
                </div>
              </motion.div>

              {/* Role selector */}
              <motion.div variants={item}>
                <label className="input-label">Your role</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                  {ROLES.map((r, i) => (
                    <motion.button key={r.value} type="button" onClick={() => setForm(p => ({ ...p, role:r.value }))}
                      initial={{ opacity:0, scale:0.9 }} animate={{ opacity:1, scale:1 }}
                      transition={{ delay:0.35 + i*0.06 }}
                      whileHover={{ scale:1.03, y:-1 }} whileTap={{ scale:0.97 }}
                      style={{ display:'flex', alignItems:'center', gap:'8px', padding:'10px 12px', borderRadius:'12px', cursor:'pointer', textAlign:'left', background: form.role === r.value ? 'rgba(99,102,241,0.18)' : 'var(--bg-hover)', border: form.role === r.value ? '1px solid rgba(99,102,241,0.45)' : '1px solid var(--border-card)', boxShadow: form.role === r.value ? '0 0 14px rgba(99,102,241,0.18)' : 'none', transition:'all 0.2s' }}>
                      <span style={{ fontSize:'16px', lineHeight:1 }}>{r.icon}</span>
                      <div>
                        <p style={{ fontSize:'12px', fontWeight:700, color: form.role === r.value ? '#a5b4fc' : 'var(--text-primary)', lineHeight:1.2 }}>{r.label}</p>
                        <p style={{ fontSize:'10px', color: form.role === r.value ? '#818cf8' : 'var(--text-muted)', lineHeight:1.3, marginTop:'1px' }}>{r.sub}</p>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>

              <motion.div variants={item}>
                <MagBtn type="submit" disabled={loading} className="btn-primary w-full btn-lg" style={{ marginTop:'4px' }}>
                  {loading ? (
                    <span style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' }}>
                      <motion.span style={{ display:'inline-block', width:'14px', height:'14px', borderRadius:'50%', border:'2px solid rgba(255,255,255,0.3)', borderTop:'2px solid white' }}
                        animate={{ rotate:360 }} transition={{ duration:0.8, repeat:Infinity, ease:'linear' }} />
                      Creating account…
                    </span>
                  ) : 'Get started →'}
                </MagBtn>
              </motion.div>
            </form>

            <motion.p style={{ textAlign:'center', fontSize:'13px', marginTop:'16px', color:'var(--text-muted)' }} variants={item}>
              Already have an account?{' '}
              <Link to="/login" style={{ fontWeight:700, color:'#818cf8', textDecoration:'none' }}
                onMouseEnter={e => e.currentTarget.style.color='#a5b4fc'}
                onMouseLeave={e => e.currentTarget.style.color='#818cf8'}>Sign in →</Link>
            </motion.p>
          </motion.div>

          <motion.p style={{ textAlign:'center', fontSize:'11px', color:'var(--text-faint)', marginTop:'12px', paddingBottom:'16px' }} variants={item}>
            By signing up you agree to our <span style={{ color:'#6366f1', cursor:'pointer' }}>Terms of Service</span>
          </motion.p>
        </motion.div>
      </div>
    </div>
  )
}
