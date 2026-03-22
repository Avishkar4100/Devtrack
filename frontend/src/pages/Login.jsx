import { useState, useRef, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BoltIcon, EyeIcon, EyeSlashIcon, SunIcon, MoonIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '@/store/authStore'
import api from '@/lib/api'
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

const features = [
  { icon:'⚡', label:'AI Story Generation', sub:'GPT-4o powered user stories in seconds' },
  { icon:'🔗', label:'GitHub + Jira Sync', sub:'Two-way real-time integration' },
  { icon:'📊', label:'Sprint Analytics', sub:'Velocity, burndown & health metrics' },
]

export default function LoginPage() {
  const [form, setForm] = useState({ email:'', password:'' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [forgotMode, setForgotMode] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [devResetUrl, setDevResetUrl] = useState(null)
  const [focusedField, setFocusedField] = useState(null)
  const { setAuth } = useAuthStore()
  const { theme } = useThemeStore()
  const navigate = useNavigate()
  const isLight = theme === 'light'

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true)
    try {
      const { data } = await api.post('/auth/login', form)
      setAuth(data.user, data.token)
      toast.success(`Welcome back, ${data.user.name}!`)
      navigate('/overview')
    } catch (err) { toast.error(err.response?.data?.message || 'Invalid email or password') }
    finally { setLoading(false) }
  }

  const handleForgot = async (e) => {
    e.preventDefault(); setLoading(true)
    try {
      const { data } = await api.post('/auth/forgot-password', { email: forgotEmail })
      if (data.devResetUrl) {
        setDevResetUrl(data.devResetUrl.split('/reset-password/')[1])
      } else { toast.success('Reset link sent! Check your inbox.', { duration:5000 }); setForgotMode(false); setForgotEmail('') }
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to send reset email') }
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

  return (
    <div style={{ minHeight:'100vh', overflowY:'auto', display:'flex', background:'var(--bg-page)', position:'relative' }}>
      <NeuralCanvas isLight={isLight} />
      <AuthThemeToggle />

      {/* Ambient orbs */}
      <motion.div style={{ position:'fixed', top:'-15%', left:'-8%', width:'600px', height:'600px', borderRadius:'50%', background:'radial-gradient(circle,rgba(99,102,241,0.15) 0%,transparent 70%)', filter:'blur(80px)', pointerEvents:'none', zIndex:1 }}
        animate={{ x:[0,40,0], y:[0,-25,0], scale:[1,1.08,1] }} transition={{ duration:10, repeat:Infinity, ease:'easeInOut' }} />
      <motion.div style={{ position:'fixed', bottom:'-15%', right:'-8%', width:'500px', height:'500px', borderRadius:'50%', background:'radial-gradient(circle,rgba(139,92,246,0.13) 0%,transparent 70%)', filter:'blur(80px)', pointerEvents:'none', zIndex:1 }}
        animate={{ x:[0,-30,0], y:[0,20,0], scale:[1,1.06,1] }} transition={{ duration:12, repeat:Infinity, ease:'easeInOut', delay:2 }} />

      {/* ── Left hero panel ── */}
      <motion.div className="hidden lg:flex w-[46%] relative flex-col justify-between p-14 overflow-hidden"
        style={{ borderRight:'1px solid var(--border)', zIndex:2, position:'sticky', top:0, height:'100vh', alignSelf:'flex-start' }}
        initial={{ opacity:0, x:-50 }} animate={{ opacity:1, x:0 }}
        transition={{ duration:0.8, ease:[0.16,1,0.3,1] }}>

        <div style={{ position:'absolute', inset:0, backgroundImage:`radial-gradient(${isLight ? 'rgba(99,102,241,0.07)' : 'rgba(99,102,241,0.04)'} 1px, transparent 1px)`, backgroundSize:'26px 26px', pointerEvents:'none' }} />
        <motion.div style={{ position:'absolute', top:0, right:'-1px', width:'1px', height:'100%', background:'linear-gradient(180deg,transparent,rgba(99,102,241,0.5),rgba(139,92,246,0.3),transparent)', pointerEvents:'none' }}
          animate={{ opacity:[0.4,1,0.4] }} transition={{ duration:3, repeat:Infinity, ease:'easeInOut' }} />

        {/* Logo + back */}
        <div className="relative flex items-center justify-between" style={{ zIndex:3 }}>
          <Link to="/" className="flex items-center gap-3" style={{ textDecoration:'none' }}>
            <motion.div style={{ width:'40px', height:'40px', borderRadius:'12px', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow:'0 4px 24px rgba(99,102,241,0.45)' }}
              animate={{ boxShadow:['0 4px 24px rgba(99,102,241,0.45)','0 4px 36px rgba(99,102,241,0.75)','0 4px 24px rgba(99,102,241,0.45)'] }}
              transition={{ duration:2.5, repeat:Infinity, ease:'easeInOut' }}>
              <BoltIcon className="w-5 h-5 text-white" />
            </motion.div>
            <span style={{ fontWeight:800, fontSize:'17px', letterSpacing:'-0.03em', color:'var(--text-primary)' }}>Dev<span className="text-gradient">Track</span></span>
          </Link>
          <Link to="/" style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'12px', fontWeight:600, color:'var(--text-muted)', textDecoration:'none', padding:'6px 12px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--bg-card)', backdropFilter:'blur(8px)', transition:'all 0.2s' }}
            onMouseEnter={e=>{ e.currentTarget.style.color='#a5b4fc'; e.currentTarget.style.borderColor='rgba(99,102,241,0.35)'; e.currentTarget.style.background='rgba(99,102,241,0.1)' }}
            onMouseLeave={e=>{ e.currentTarget.style.color='var(--text-muted)'; e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-card)' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Home
          </Link>
        </div>

        {/* Hero copy */}
        <div className="relative" style={{ zIndex:3 }}>
          <motion.div initial={{ opacity:0, y:30 }} animate={{ opacity:1, y:0 }}
            transition={{ delay:0.35, duration:0.8, ease:[0.16,1,0.3,1] }}>
            <motion.div style={{ display:'inline-flex', alignItems:'center', gap:'8px', background:'rgba(99,102,241,0.12)', border:'1px solid rgba(99,102,241,0.28)', borderRadius:'99px', padding:'5px 14px', marginBottom:'22px' }}
              initial={{ opacity:0, scale:0.85 }} animate={{ opacity:1, scale:1 }} transition={{ delay:0.6, duration:0.5 }}>
              <motion.span style={{ width:'6px', height:'6px', borderRadius:'50%', background:'#6366f1', display:'block', flexShrink:0 }}
                animate={{ scale:[1,1.6,1], opacity:[1,0.5,1] }} transition={{ duration:1.8, repeat:Infinity }} />
              <span style={{ fontSize:'11px', fontWeight:700, color:'#818cf8', letterSpacing:'0.06em', textTransform:'uppercase' }}>AI-Powered Agile</span>
            </motion.div>
            <h2 style={{ fontSize:'2.75rem', fontWeight:900, lineHeight:1.08, marginBottom:'18px', letterSpacing:'-0.045em', color:'var(--text-primary)' }}>
              From ideas<br />
              <span style={{ background:'linear-gradient(135deg,#818cf8,#a78bfa,#c084fc)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>to backlogs</span><br />
              in seconds.
            </h2>
            <p style={{ fontSize:'14px', lineHeight:1.75, color:'var(--text-secondary)', maxWidth:'340px' }}>
              Upload your SRS, let GPT-4o generate epics, stories and ACs — then push to Jira in one click.
            </p>
          </motion.div>
        </div>

        {/* Feature cards */}
        <div className="relative space-y-3" style={{ zIndex:3 }}>
          {features.map((f, i) => (
            <motion.div key={f.label}
              initial={{ opacity:0, x:-24 }} animate={{ opacity:1, x:0 }}
              transition={{ delay:0.55 + i*0.12, duration:0.6, ease:[0.16,1,0.3,1] }}
              whileHover={{ x:6, scale:1.015 }}
              style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px 16px', borderRadius:'14px', background:'var(--bg-card)', border:'1px solid var(--border-card)', backdropFilter:'blur(12px)', cursor:'default', transition:'border-color 0.2s, box-shadow 0.2s' }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor='rgba(99,102,241,0.3)'; e.currentTarget.style.boxShadow='0 4px 20px rgba(99,102,241,0.1)' }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor='var(--border-card)'; e.currentTarget.style.boxShadow='none' }}>
              <span style={{ fontSize:'20px', lineHeight:1 }}>{f.icon}</span>
              <div>
                <p style={{ fontSize:'13px', fontWeight:600, color:'var(--text-primary)', marginBottom:'1px' }}>{f.label}</p>
                <p style={{ fontSize:'11px', color:'var(--text-muted)' }}>{f.sub}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── Right form panel ── */}
      <motion.div className="flex-1 flex items-center justify-center px-6" style={{ zIndex:2, position:'relative', minHeight:'100vh' }}
        initial={{ opacity:0, x:40 }} animate={{ opacity:1, x:0 }}
        transition={{ duration:0.7, ease:[0.16,1,0.3,1], delay:0.15 }}>
        <div style={{ width:'100%', maxWidth:'420px', paddingTop:'24px', paddingBottom:'24px' }}>

          {/* Mobile back */}
          <div className="flex lg:hidden" style={{ marginBottom:'20px' }}>
            <Link to="/" style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'13px', fontWeight:600, color:'var(--text-muted)', textDecoration:'none', padding:'7px 14px', borderRadius:'9px', border:'1px solid var(--border)', background:'var(--bg-card)', backdropFilter:'blur(8px)', transition:'all 0.2s' }}
              onMouseEnter={e=>{ e.currentTarget.style.color='#a5b4fc'; e.currentTarget.style.borderColor='rgba(99,102,241,0.3)' }}
              onMouseLeave={e=>{ e.currentTarget.style.color='var(--text-muted)'; e.currentTarget.style.borderColor='var(--border)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              Back to Home
            </Link>
          </div>

          {/* Glass card */}
          <motion.div style={{ background:'var(--bg-card)', border:'1px solid var(--border-card)', borderRadius:'24px', padding:'36px 36px 32px', backdropFilter:'blur(24px)', WebkitBackdropFilter:'blur(24px)', boxShadow: isLight ? '0 8px 40px rgba(0,0,0,0.1),0 1px 3px rgba(0,0,0,0.06)' : '0 8px 40px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.02)', position:'relative', overflow:'hidden' }}
            initial={{ opacity:0, y:24, scale:0.97 }} animate={{ opacity:1, y:0, scale:1 }}
            transition={{ delay:0.3, duration:0.6, ease:[0.16,1,0.3,1] }}>

            {/* Top glow bar */}
            <div style={{ position:'absolute', top:0, left:'20%', right:'20%', height:'1px', background:'linear-gradient(90deg,transparent,rgba(99,102,241,0.55),rgba(139,92,246,0.4),transparent)', pointerEvents:'none' }} />
            {/* Corner shine */}
            <div style={{ position:'absolute', top:'-30px', right:'-30px', width:'80px', height:'80px', background:'radial-gradient(circle,rgba(99,102,241,0.15) 0%,transparent 70%)', pointerEvents:'none' }} />

            <AnimatePresence mode="wait">
            {!forgotMode ? (
              <motion.div key="login"
                initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-12 }}
                transition={{ duration:0.35, ease:[0.16,1,0.3,1] }}>

                <div style={{ marginBottom:'26px' }}>
                  <div className="flex lg:hidden items-center gap-2.5 mb-3">
                    <div style={{ width:'30px', height:'30px', borderRadius:'9px', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                      <BoltIcon className="w-4 h-4 text-white" />
                    </div>
                    <span style={{ fontWeight:800, fontSize:'14px', color:'var(--text-primary)' }}>Dev<span className="text-gradient">Track</span></span>
                  </div>
                  <h1 style={{ fontSize:'1.65rem', fontWeight:900, letterSpacing:'-0.04em', color:'var(--text-primary)', lineHeight:1.1, marginBottom:'6px' }}>Welcome back</h1>
                  <p style={{ fontSize:'13px', color:'var(--text-muted)' }}>Sign in to your DevTrack workspace</p>
                </div>

                {/* Social buttons */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'18px' }}>
                  {[['GitHub', <GitHubIcon key="gh"/>], ['Google', <GoogleIcon key="go"/>]].map(([p, icon], i) => (
                    <motion.button key={p} onClick={() => handleSocial(p)}
                      initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
                      transition={{ delay:0.2 + i*0.08, duration:0.3 }}
                      whileHover={{ scale:1.03, y:-1 }} whileTap={{ scale:0.97 }}
                      style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', padding:'10px 0', borderRadius:'12px', fontSize:'13px', fontWeight:600, cursor:'pointer', background:'var(--bg-hover)', border:'1px solid var(--border-card)', color:'var(--text-primary)', transition:'border-color 0.2s,box-shadow 0.2s' }}
                      onMouseEnter={e=>{ e.currentTarget.style.borderColor='rgba(99,102,241,0.3)'; e.currentTarget.style.boxShadow='0 4px 12px rgba(99,102,241,0.1)' }}
                      onMouseLeave={e=>{ e.currentTarget.style.borderColor='var(--border-card)'; e.currentTarget.style.boxShadow='none' }}>
                      {icon}{p}
                    </motion.button>
                  ))}
                </div>

                <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'18px' }}>
                  <div style={{ flex:1, height:'1px', background:'var(--border)' }} />
                  <span style={{ fontSize:'11px', color:'var(--text-muted)', whiteSpace:'nowrap' }}>or continue with email</span>
                  <div style={{ flex:1, height:'1px', background:'var(--border)' }} />
                </div>

                <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
                  <div>
                    <label className="input-label">Email address</label>
                    <input type="email" className="input" placeholder="you@company.com"
                      value={form.email} onChange={e => setForm(p => ({ ...p, email:e.target.value }))}
                      onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)}
                      style={inputStyle('email')} required />
                  </div>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'6px' }}>
                      <label className="input-label" style={{ marginBottom:0 }}>Password</label>
                      <motion.button type="button" onClick={() => setForgotMode(true)}
                        style={{ fontSize:'11px', fontWeight:600, color:'#6366f1', background:'none', border:'none', cursor:'pointer', padding:0 }}
                        whileHover={{ scale:1.05 }} whileTap={{ scale:0.95 }}>Forgot?</motion.button>
                    </div>
                    <div style={{ position:'relative' }}>
                      <input type={showPw ? 'text' : 'password'} className="input pr-10" placeholder="••••••••"
                        value={form.password} onChange={e => setForm(p => ({ ...p, password:e.target.value }))}
                        onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)}
                        style={inputStyle('password')} required />
                      <button type="button" onClick={() => setShowPw(!showPw)}
                        style={{ position:'absolute', right:'12px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)' }}>
                        {showPw ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <MagBtn type="submit" disabled={loading} className="btn-primary btn-lg w-full" style={{ marginTop:'4px' }}>
                    {loading ? (
                      <span style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' }}>
                        <motion.span style={{ display:'inline-block', width:'14px', height:'14px', borderRadius:'50%', border:'2px solid rgba(255,255,255,0.3)', borderTop:'2px solid white' }}
                          animate={{ rotate:360 }} transition={{ duration:0.8, repeat:Infinity, ease:'linear' }} />
                        Signing in…
                      </span>
                    ) : 'Sign in →'}
                  </MagBtn>
                </form>

                <p style={{ textAlign:'center', fontSize:'13px', marginTop:'18px', color:'var(--text-muted)' }}>
                  No account?{' '}
                  <Link to="/register" style={{ fontWeight:700, color:'#818cf8', textDecoration:'none' }}
                    onMouseEnter={e => e.currentTarget.style.color='#a5b4fc'}
                    onMouseLeave={e => e.currentTarget.style.color='#818cf8'}>Create one free →</Link>
                </p>
              </motion.div>

            ) : (
              <motion.div key="forgot"
                initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-12 }}
                transition={{ duration:0.35, ease:[0.16,1,0.3,1] }}>
                <motion.button onClick={() => { setForgotMode(false); setDevResetUrl(null) }}
                  style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'13px', marginBottom:'20px', color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer', padding:0 }}
                  whileHover={{ x:-3 }} transition={{ type:'spring', stiffness:400 }}>
                  ← Back
                </motion.button>
                <h1 style={{ fontSize:'1.5rem', fontWeight:900, letterSpacing:'-0.04em', color:'var(--text-primary)', marginBottom:'6px' }}>Reset password</h1>
                <p style={{ fontSize:'13px', color:'var(--text-muted)', marginBottom:'20px' }}>We'll send a reset link to your email.</p>
                {devResetUrl ? (
                  <div style={{ padding:'16px', borderRadius:'14px', background:'rgba(99,102,241,0.1)', border:'1px solid rgba(99,102,241,0.25)' }}>
                    <p style={{ fontSize:'13px', fontWeight:700, color:'#a5b4fc', marginBottom:'8px' }}>Dev mode — reset token:</p>
                    <p style={{ fontSize:'11px', fontFamily:'JetBrains Mono,monospace', wordBreak:'break-all', color:'#818cf8', marginBottom:'10px' }}>{devResetUrl}</p>
                    <Link to={`/reset-password/${devResetUrl}`} className="btn-primary btn-sm">Reset now</Link>
                  </div>
                ) : (
                  <form onSubmit={handleForgot} style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
                    <div>
                      <label className="input-label">Email address</label>
                      <input type="email" className="input" placeholder="you@company.com"
                        value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required />
                    </div>
                    <MagBtn type="submit" disabled={loading} className="btn-primary w-full btn-lg">
                      {loading ? 'Sending…' : 'Send reset link →'}
                    </MagBtn>
                  </form>
                )}
              </motion.div>
            )}
            </AnimatePresence>
          </motion.div>

          <motion.p style={{ textAlign:'center', fontSize:'11px', color:'var(--text-faint)', marginTop:'14px' }}
            initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.9 }}>
            DevTrack · AI-Powered Agile · <span style={{ color:'#6366f1' }}>✦</span>
          </motion.p>
        </div>
      </motion.div>
    </div>
  )
}
