import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useProjectStore } from '@/store/projectStore'
import api from '@/lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import PageErrorBoundary from '@/components/PageErrorBoundary'
import { useProjectSocket } from '@/lib/useProjectSocket'
import toast from 'react-hot-toast'
import {
  FolderIcon, RocketLaunchIcon, DocumentTextIcon, SparklesIcon,
  ArrowTrendingUpIcon, ClockIcon, ChevronRightIcon, BoltIcon,
  CheckCircleIcon, ArrowRightIcon,
} from '@heroicons/react/24/outline'
import { getProgressColor, formatRelativeTime } from '@/lib/utils'
import { useThemeStore } from '@/store/themeStore'

const fadeUp   = { hidden:{ opacity:0, y:24 }, show:{ opacity:1, y:0 } }
const fadeScale = { hidden:{ opacity:0, scale:0.92 }, show:{ opacity:1, scale:1 } }
const stagger  = { show:{ transition:{ staggerChildren:0.07 } } }

const getGreeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

const statusMap = {
  active:    { cls:'badge-done',         label:'Active' },
  planning:  { cls:'badge-draft',        label:'Planning' },
  paused:    { cls:'badge-partial',      label:'Paused' },
  completed: { cls:'badge-in-progress',  label:'Completed' },
  archived:  { cls:'badge-not-started',  label:'Archived' },
}
const StatusBadge = ({ status }) => {
  const s = statusMap[status] || statusMap.archived
  return <span className={`badge ${s.cls} capitalize`}>{s.label}</span>
}

/* ── Animated Stat Card ── */
function StatCard({ label, value, Icon, accent, delay = 0, sub }) {
  return (
    <motion.div variants={fadeScale} transition={{ duration:0.55, delay, ease:[0.16,1,0.3,1] }}
      whileHover={{ y:-4,  boxShadow:`0 12px 36px ${accent}28` }}
      style={{ background:'var(--bg-card)', border:'1px solid var(--border-card)', borderRadius:'16px', padding:'20px', position:'relative', overflow:'hidden', cursor:'default', boxShadow:'var(--shadow-card)', transition:'box-shadow 0.3s,transform 0.3s' }}>

      {/* Top accent line */}
      <div style={{ position:'absolute', top:0, left:0, right:0, height:'2px', background:`linear-gradient(90deg,${accent},${accent}77,transparent)` }} />
      {/* Radial glow */}
      <motion.div style={{ position:'absolute', top:'-30px', right:'-30px', width:'100px', height:'100px', borderRadius:'50%', background:`radial-gradient(circle,${accent}22 0%,transparent 70%)`, pointerEvents:'none' }}
        animate={{ scale:[1,1.2,1] }} transition={{ duration:3, repeat:Infinity, ease:'easeInOut', delay }} />
      {/* Bottom shimmer */}
      <div style={{ position:'absolute', bottom:0, left:'10%', right:'10%', height:'1px', background:`linear-gradient(90deg,transparent,${accent}44,transparent)` }} />

      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', position:'relative' }}>
        <div>
          <p style={{ fontSize:'11px', fontWeight:600, color:'var(--text-muted)', marginBottom:'8px', letterSpacing:'0.04em', textTransform:'uppercase' }}>{label}</p>
          <motion.p style={{ fontSize:'2.2rem', fontWeight:900, lineHeight:1, color:'var(--text-primary)', letterSpacing:'-0.05em' }}
            initial={{ opacity:0, scale:0.5 }} animate={{ opacity:1, scale:1 }} transition={{ duration:0.6, delay:delay+0.2, ease:[0.34,1.56,0.64,1] }}>
            {value}
          </motion.p>
          {sub && <p style={{ fontSize:'11px', color:'var(--text-muted)', marginTop:'4px' }}>{sub}</p>}
        </div>
        <motion.div style={{ width:'42px', height:'42px', borderRadius:'12px', display:'flex', alignItems:'center', justifyContent:'center', background:`linear-gradient(135deg,${accent}30,${accent}18)`, border:`1px solid ${accent}35` }}
          whileHover={{ scale:1.1, rotate:8 }} transition={{ type:'spring', stiffness:400 }}>
          <Icon style={{ width:'18px', height:'18px', color:accent }} />
        </motion.div>
      </div>
    </motion.div>
  )
}

/* ── Project Card ── */
function ProjectCard({ project, index }) {
  const progress = project.stats?.completedStories
    ? Math.round((project.stats.completedStories / project.stats.totalStories) * 100)
    : 0
  const color = project.color || '#6366f1'

  return (
    <motion.div variants={fadeUp} transition={{ duration:0.5, ease:[0.16,1,0.3,1] }}>
      <Link to={`/projects/${project._id}`} style={{ textDecoration:'none', display:'block' }}>
        <motion.div
          whileHover={{ y:-3, boxShadow:`0 12px 36px ${color}20`, borderColor:`${color}50` }}
          style={{ background:'var(--bg-card)', border:'1px solid var(--border-card)', borderRadius:'16px', padding:'16px 18px', cursor:'pointer', transition:'all 0.25s', display:'flex', alignItems:'center', gap:'14px', position:'relative', overflow:'hidden', boxShadow:'var(--shadow-card)' }}>

          {/* Left color bar */}
          <div style={{ position:'absolute', left:0, top:'15%', bottom:'15%', width:'3px', borderRadius:'99px', background:`linear-gradient(180deg,${color},${color}66)` }} />

          {/* Project avatar */}
          <motion.div whileHover={{ scale:1.08, rotate:4 }} transition={{ type:'spring', stiffness:400 }}
            style={{ width:'44px', height:'44px', borderRadius:'12px', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:800, fontSize:'14px', flexShrink:0, background:`linear-gradient(135deg,${color},${color}bb)`, boxShadow:`0 4px 14px ${color}50`, letterSpacing:'-0.02em' }}>
            {project.key?.slice(0,2)}
          </motion.div>

          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'6px' }}>
              <p style={{ fontWeight:700, color:'var(--text-primary)', fontSize:'14px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'200px', letterSpacing:'-0.02em' }}>{project.name}</p>
              <StatusBadge status={project.status} />
            </div>
            {/* Progress */}
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <div style={{ flex:1, height:'4px', borderRadius:'99px', background:'var(--progress-bg)', overflow:'hidden' }}>
                <motion.div style={{ height:'100%', borderRadius:'99px', background:`linear-gradient(90deg,${color},${color}bb)` }}
                  initial={{ width:0 }} animate={{ width:`${progress}%` }}
                  transition={{ duration:1.2, delay: index * 0.1 + 0.3, ease:[0.16,1,0.3,1] }} />
              </div>
              <span style={{ fontSize:'11px', fontWeight:600, color:'var(--text-muted)', flexShrink:0 }}>{progress}%</span>
              {project.stats?.totalStories > 0 && (
                <span style={{ fontSize:'11px', color:'var(--text-faint)', flexShrink:0 }}>{project.stats.completedStories}/{project.stats.totalStories}</span>
              )}
            </div>
          </div>

          <ChevronRightIcon style={{ width:'14px', height:'14px', color:'var(--text-faint)', flexShrink:0 }} />
        </motion.div>
      </Link>
    </motion.div>
  )
}

export default function DashboardPage() {
  return (
    <PageErrorBoundary pageName="Dashboard">
      <DashboardContent />
    </PageErrorBoundary>
  )
}

function DashboardContent() {
  const { user } = useAuthStore()
  const { setProjects } = useProjectStore()
  const { theme } = useThemeStore()
  const isLight = theme === 'light'
  const [realtimeUpdates, setRealtimeUpdates] = useState({})

  const { data: projectsData, refetch: refetchProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => { const { data } = await api.get('/projects'); setProjects(data.data); return data.data },
  })
  const { data: overviewData, refetch: refetchOverview } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: async () => { const { data } = await api.get('/dashboard/overview'); return data.data },
  })

  const projects = projectsData || []
  const activeProjects = projects.filter(p => p.status === 'active')

  // Listen to real-time updates from active projects
  const firstActiveProjectId = activeProjects[0]?._id
  useProjectSocket(firstActiveProjectId, {
    onStoryCreated: () => {
      setRealtimeUpdates(prev => ({ ...prev, lastUpdate: `Story created at ${new Date().toLocaleTimeString()}` }))
      refetchOverview()
      toast.success('📖 New story created!', { position: 'bottom-right' })
    },
    onStoryUpdated: () => {
      setRealtimeUpdates(prev => ({ ...prev, lastUpdate: `Story updated at ${new Date().toLocaleTimeString()}` }))
      refetchOverview()
    },
    onStoriesSaved: (data) => {
      setRealtimeUpdates(prev => ({ ...prev, lastUpdate: `Backlog saved: ${data.totalCount} items` }))
      refetchOverview()
      refetchProjects()
      toast.success(`✅ Saved ${data.totalCount} backlog items!`, { position: 'bottom-right' })
    },
    onSprintUpdated: () => {
      refetchOverview()
      toast.success('🎯 Sprint updated!', { position: 'bottom-right' })
    },
  })

  const stats = [
    { label:'Projects',        value:projects.length,                   Icon:FolderIcon,         accent:'#6366f1', delay:0,    sub:'total' },
    { label:'Active',          value:activeProjects.length,             Icon:ArrowTrendingUpIcon, accent:'#10b981', delay:0.07, sub:'in progress' },
    { label:'Stories',         value:overviewData?.totalStories || 0,   Icon:RocketLaunchIcon,    accent:'#f59e0b', delay:0.14, sub:'generated' },
    { label:'Completed',       value:overviewData?.completedStories||0, Icon:SparklesIcon,        accent:'#8b5cf6', delay:0.21, sub:'done' },
  ]

  return (
    <div style={{ padding:'28px 32px', maxWidth:'1400px', margin:'0 auto', minHeight:'100%' }}>

      {/* ── Greeting Banner ── */}
      <motion.div initial={{ opacity:0, y:-20 }} animate={{ opacity:1, y:0 }}
        transition={{ duration:0.65, ease:[0.16,1,0.3,1] }}
        style={{ marginBottom:'28px', borderRadius:'20px', padding:'28px 32px', background:'linear-gradient(135deg,#4f46e5 0%,#7c3aed 55%,#6d28d9 100%)', boxShadow:'0 8px 40px rgba(79,70,229,0.35)', position:'relative', overflow:'hidden' }}>

        {/* Dot mesh */}
        <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(rgba(255,255,255,0.07) 1px,transparent 1px)', backgroundSize:'26px 26px', pointerEvents:'none' }} />
        {/* Orbs */}
        <motion.div animate={{ y:[-8,8,-8], x:[4,-4,4] }} transition={{ duration:6, repeat:Infinity, ease:'easeInOut' }}
          style={{ position:'absolute', right:'-20px', top:'-40px', width:'200px', height:'200px', borderRadius:'50%', background:'radial-gradient(circle,rgba(255,255,255,0.2) 0%,transparent 70%)', filter:'blur(20px)', pointerEvents:'none' }} />
        <motion.div animate={{ y:[5,-5,5] }} transition={{ duration:4.5, repeat:Infinity, ease:'easeInOut', delay:1 }}
          style={{ position:'absolute', right:'160px', bottom:'-25px', width:'110px', height:'110px', borderRadius:'50%', background:'radial-gradient(circle,rgba(255,255,255,0.14) 0%,transparent 70%)', filter:'blur(14px)', pointerEvents:'none' }} />
        <motion.div animate={{ x:[-6,6,-6], y:[3,-3,3] }} transition={{ duration:7, repeat:Infinity, ease:'easeInOut', delay:0.5 }}
          style={{ position:'absolute', left:'-30px', bottom:'-30px', width:'150px', height:'150px', borderRadius:'50%', background:'radial-gradient(circle,rgba(255,255,255,0.1) 0%,transparent 70%)', filter:'blur(20px)', pointerEvents:'none' }} />

        <div style={{ position:'relative', zIndex:2 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'6px' }}>
            <motion.div style={{ width:'6px', height:'6px', borderRadius:'50%', background:'#a5b4fc' }}
              animate={{ scale:[1,1.6,1], opacity:[1,0.5,1] }} transition={{ duration:1.8, repeat:Infinity }} />
            <p style={{ color:'rgba(199,210,254,0.85)', fontSize:'12px', fontWeight:600, letterSpacing:'0.04em', textTransform:'uppercase' }}>
              {new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })}
            </p>
          </div>
          <h1 style={{ fontSize:'1.6rem', fontWeight:900, color:'#fff', marginBottom:'4px', letterSpacing:'-0.035em', lineHeight:1.1 }}>
            Good {getGreeting()}, {user?.name?.split(' ')[0]} 👋
          </h1>
          <p style={{ color:'rgba(199,210,254,0.75)', fontSize:'14px' }}>Here's your DevTrack overview — let's build something great today.</p>

          {/* Quick action */}
          <div style={{ display:'flex', gap:'10px', marginTop:'18px' }}>
            <Link to="/projects" style={{ display:'inline-flex', alignItems:'center', gap:'6px', padding:'8px 16px', borderRadius:'10px', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.2)', color:'white', textDecoration:'none', fontSize:'13px', fontWeight:600, backdropFilter:'blur(8px)', transition:'all 0.2s' }}
              onMouseEnter={e=>{ e.currentTarget.style.background='rgba(255,255,255,0.22)'; e.currentTarget.style.transform='translateY(-1px)' }}
              onMouseLeave={e=>{ e.currentTarget.style.background='rgba(255,255,255,0.15)'; e.currentTarget.style.transform='none' }}>
              <FolderIcon style={{ width:'14px', height:'14px' }} /> Projects
            </Link>
          </div>
        </div>
      </motion.div>

      {/* ── Stats Grid ── */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:'14px', marginBottom:'28px' }}
        className="lg:grid-cols-4">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </motion.div>

      {/* ── Main content grid ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:'22px' }} className="lg:grid-cols-3">

        {/* Projects (2/3) */}
        <div style={{ gridColumn:'span 1' }} className="lg:col-span-2">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <FolderIcon style={{ width:'16px', height:'16px', color:'#818cf8' }} />
              <h2 style={{ fontSize:'15px', fontWeight:700, color:'var(--text-primary)', letterSpacing:'-0.025em' }}>Recent Projects</h2>
              {projects.length > 0 && (
                <span style={{ fontSize:'11px', fontWeight:700, padding:'2px 7px', borderRadius:'6px', background:'rgba(99,102,241,0.15)', color:'#818cf8', border:'1px solid rgba(99,102,241,0.2)' }}>{projects.length}</span>
              )}
            </div>
            <Link to="/projects"
              style={{ fontSize:'12px', fontWeight:600, color:'#818cf8', textDecoration:'none', display:'flex', alignItems:'center', gap:'4px', padding:'5px 10px', borderRadius:'8px', background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.18)', transition:'all 0.2s' }}
              onMouseEnter={e=>{ e.currentTarget.style.background='rgba(99,102,241,0.15)'; e.currentTarget.style.color='#a5b4fc' }}
              onMouseLeave={e=>{ e.currentTarget.style.background='rgba(99,102,241,0.08)'; e.currentTarget.style.color='#818cf8' }}>
              View all <ArrowRightIcon style={{ width:'12px', height:'12px' }} />
            </Link>
          </div>

          {projects.length === 0 ? (
            <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }}
              style={{ background:'var(--bg-card)', border:'1px solid var(--border-card)', borderRadius:'18px', padding:'56px 24px', textAlign:'center', boxShadow:'var(--shadow-card)' }}>
              <motion.div animate={{ y:[0,-10,0] }} transition={{ duration:3.5, repeat:Infinity, ease:'easeInOut' }}
                style={{ width:'60px', height:'60px', borderRadius:'18px', margin:'0 auto 16px', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.1))', border:'1px solid rgba(99,102,241,0.2)' }}>
                <FolderIcon style={{ width:'28px', height:'28px', color:'#818cf8' }} />
              </motion.div>
              <p style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:'6px', fontSize:'16px', letterSpacing:'-0.02em' }}>No projects yet</p>
              <p style={{ color:'var(--text-muted)', fontSize:'13px', marginBottom:'20px' }}>Create your first project to get started!</p>
              <Link to="/projects" className="btn-primary">Create Project</Link>
            </motion.div>
          ) : (
            <motion.div variants={stagger} initial="hidden" animate="show" style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
              {projects.slice(0, 6).map((project, i) => (
                <ProjectCard key={project._id} project={project} index={i} />
              ))}
            </motion.div>
          )}
        </div>

        {/* Sidebar (1/3) */}
        <div style={{ display:'flex', flexDirection:'column', gap:'18px' }}>

          {/* Quick stats */}
          <motion.div initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }}
            transition={{ delay:0.3, duration:0.55, ease:[0.16,1,0.3,1] }}
            style={{ background:'var(--bg-card)', border:'1px solid var(--border-card)', borderRadius:'16px', padding:'20px', boxShadow:'var(--shadow-card)',  position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:0, left:0, right:0, height:'2px', background:'linear-gradient(90deg,#6366f1,#8b5cf6,transparent)' }} />
            <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'16px' }}>
              <SparklesIcon style={{ width:'15px', height:'15px', color:'#a78bfa' }} />
              <h3 style={{ fontSize:'14px', fontWeight:700, color:'var(--text-primary)', letterSpacing:'-0.02em' }}>AI Overview</h3>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
              {[
                { label:'Stories generated', value: overviewData?.totalStories || 0, color:'#6366f1' },
                { label:'Completed stories', value: overviewData?.completedStories || 0, color:'#10b981' },
                { label:'In progress',        value: (overviewData?.totalStories || 0) - (overviewData?.completedStories || 0), color:'#f59e0b' },
              ].map((item) => (
                <div key={item.label} style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:item.color, boxShadow:`0 0 6px ${item.color}88` }} />
                    <span style={{ fontSize:'12px', color:'var(--text-secondary)' }}>{item.label}</span>
                  </div>
                  <motion.span style={{ fontSize:'14px', fontWeight:800, color:'var(--text-primary)', letterSpacing:'-0.03em' }}
                    initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.4, delay:0.5 }}>
                    {item.value}
                  </motion.span>
                </div>
              ))}
            </div>
            {/* Progress bar */}
            {overviewData?.totalStories > 0 && (
              <div style={{ marginTop:'16px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
                  <span style={{ fontSize:'11px', color:'var(--text-muted)' }}>Completion rate</span>
                  <span style={{ fontSize:'11px', fontWeight:700, color:'#10b981' }}>
                    {Math.round((overviewData.completedStories / overviewData.totalStories) * 100)}%
                  </span>
                </div>
                <div style={{ height:'5px', borderRadius:'99px', background:'var(--progress-bg)', overflow:'hidden' }}>
                  <motion.div style={{ height:'100%', borderRadius:'99px', background:'linear-gradient(90deg,#6366f1,#10b981)' }}
                    initial={{ width:0 }} animate={{ width:`${Math.round((overviewData.completedStories / overviewData.totalStories) * 100)}%` }}
                    transition={{ duration:1.5, delay:0.6, ease:[0.16,1,0.3,1] }} />
                </div>
              </div>
            )}
          </motion.div>

          {/* Today's tip */}
          <motion.div initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }}
            transition={{ delay:0.4, duration:0.55, ease:[0.16,1,0.3,1] }}
            style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.07))', border:'1px solid rgba(99,102,241,0.2)', borderRadius:'16px', padding:'18px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'10px' }}>
              <motion.div style={{ width:'28px', height:'28px', borderRadius:'8px', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center' }}
                animate={{ boxShadow:['0 0 8px rgba(99,102,241,0.4)','0 0 20px rgba(99,102,241,0.7)','0 0 8px rgba(99,102,241,0.4)'] }}
                transition={{ duration:2.5, repeat:Infinity, ease:'easeInOut' }}>
                <BoltIcon style={{ width:'14px', height:'14px', color:'white' }} />
              </motion.div>
              <span style={{ fontSize:'12px', fontWeight:700, color:'#818cf8', letterSpacing:'0.04em', textTransform:'uppercase' }}>AI Tip</span>
            </div>
            <p style={{ fontSize:'13px', color:'var(--text-secondary)', lineHeight:1.65 }}>
              Upload a requirements document to let AI instantly generate user stories with acceptance criteria for your next sprint.
            </p>
            <Link to="/projects" style={{ display:'inline-flex', alignItems:'center', gap:'4px', fontSize:'12px', fontWeight:600, color:'#818cf8', textDecoration:'none', marginTop:'10px', transition:'color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.color='#a5b4fc'}
              onMouseLeave={e => e.currentTarget.style.color='#818cf8'}>
              Try it now <ArrowRightIcon style={{ width:'12px', height:'12px' }} />
            </Link>
          </motion.div>

          {/* Active projects quick links */}
          {activeProjects.length > 0 && (
            <motion.div initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }}
              transition={{ delay:0.5, duration:0.55, ease:[0.16,1,0.3,1] }}
              style={{ background:'var(--bg-card)', border:'1px solid var(--border-card)', borderRadius:'16px', padding:'18px', boxShadow:'var(--shadow-card)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'14px' }}>
                <ArrowTrendingUpIcon style={{ width:'15px', height:'15px', color:'#34d399' }} />
                <h3 style={{ fontSize:'14px', fontWeight:700, color:'var(--text-primary)', letterSpacing:'-0.02em' }}>Active Now</h3>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                {activeProjects.slice(0, 3).map((p) => (
                  <Link key={p._id} to={`/projects/${p._id}`}
                    style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 10px', borderRadius:'10px', textDecoration:'none', background:'var(--bg-hover)', border:'1px solid transparent', transition:'all 0.2s' }}
                    onMouseEnter={e=>{ e.currentTarget.style.borderColor='rgba(99,102,241,0.2)'; e.currentTarget.style.background='rgba(99,102,241,0.06)' }}
                    onMouseLeave={e=>{ e.currentTarget.style.borderColor='transparent'; e.currentTarget.style.background='var(--bg-hover)' }}>
                    <div style={{ width:'28px', height:'28px', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', background:`linear-gradient(135deg,${p.color||'#6366f1'},${p.color||'#6366f1'}aa)`, color:'white', fontSize:'10px', fontWeight:800, flexShrink:0 }}>
                      {p.key?.slice(0,2)}
                    </div>
                    <span style={{ fontSize:'13px', fontWeight:600, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{p.name}</span>
                    <ChevronRightIcon style={{ width:'12px', height:'12px', color:'var(--text-faint)', flexShrink:0 }} />
                  </Link>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
}
