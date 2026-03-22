import { Outlet, NavLink } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { useProjectStore } from '@/store/projectStore'
import api from '@/lib/api'
import {
  HomeIcon, FolderIcon, CogIcon, ArrowRightOnRectangleIcon,
  BellIcon, ChevronUpDownIcon, Bars3Icon, XMarkIcon,
  BoltIcon,
  SparklesIcon,
  SunIcon, MoonIcon,
} from '@heroicons/react/24/outline'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '@/store/themeStore'

function ThemeToggle() {
  const { theme, toggleTheme } = useThemeStore()
  return (
    <motion.button
      onClick={toggleTheme}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        width: '32px', height: '32px', borderRadius: '9px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-card)', border: '1px solid var(--border-card)',
        color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0,
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 45, opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.2 }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {theme === 'dark'
            ? <SunIcon style={{ width: '14px', height: '14px' }} />
            : <MoonIcon style={{ width: '14px', height: '14px' }} />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )
}

export default function Layout() {
  const { user, logout } = useAuthStore()
  const {
    projects,
    setProjects,
    selectedProjectId,
    setSelectedProjectId,
    selectedJiraProjectKey,
    setSelectedJiraProjectKey,
  } = useProjectStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const avatarLetter = user?.name?.[0]?.toUpperCase()

  const { data: fetchedProjectsData } = useQuery({
    queryKey: ['layout-projects'],
    queryFn: async () => (await api.get('/projects')).data.data || [],
  })

  const { data: jiraProjects = [] } = useQuery({
    queryKey: ['layout-jira-projects'],
    queryFn: async () => (await api.get('/jira/server/projects')).data.data || [],
  })

  const fetchedProjects = useMemo(() => fetchedProjectsData || [], [fetchedProjectsData])

  useEffect(() => {
    if (!fetchedProjectsData) return

    const sameLength = projects.length === fetchedProjects.length
    const sameIds = sameLength && projects.every((p, idx) => p?._id === fetchedProjects[idx]?._id)
    if (sameIds) return

    setProjects(fetchedProjects)
  }, [fetchedProjectsData, fetchedProjects, projects, setProjects])

  const activeProject = useMemo(
    () => projects.find((p) => p._id === selectedProjectId) || null,
    [projects, selectedProjectId]
  )

  useEffect(() => {
    if (!activeProject) return
    const connectedJiraKey = activeProject.jiraProjectKey || ''
    if (connectedJiraKey && selectedJiraProjectKey !== connectedJiraKey) {
      setSelectedJiraProjectKey(connectedJiraKey)
    }
  }, [activeProject, selectedJiraProjectKey, setSelectedJiraProjectKey])

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-page)' }}>

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col transform transition-transform duration-300 lg:relative lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          width: '228px',
          background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border)',
          flexShrink: 0,
          boxShadow: '2px 0 20px rgba(0,0,0,0.4)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-[17px]"
             style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center justify-center shrink-0"
               style={{ width:'32px', height:'32px', borderRadius:'10px', background:'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow:'0 4px 14px rgba(99,102,241,0.4)' }}>
            <BoltIcon className="text-white" style={{ width:'18px', height:'18px' }} />
          </div>
          <span className="font-extrabold text-[15px] tracking-tight flex-1" style={{ color: 'var(--text-primary)' }}>
            Dev<span className="text-gradient">Track</span>
          </span>
          {/* Live indicator */}
          <span style={{ display: 'flex', position: 'relative', width: '8px', height: '8px', marginRight: '4px' }} className="hidden lg:flex">
            <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#10b981', opacity: 0.6, animation: 'ping 2s ease-out infinite' }} />
            <span style={{ position: 'relative', width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'block' }} />
          </span>
          <button className="lg:hidden transition-colors rounded-lg p-1"
                  style={{ color: '#64748b' }}
                  onClick={() => setSidebarOpen(false)}>
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2.5 py-3 overflow-y-auto no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {[
            { to: '/overview', end: true, Icon: HomeIcon, label: 'Overview' },
            { to: '/ai-planner', end: false, Icon: SparklesIcon, label: 'AI Planner' },
            { to: '/workspace', end: false, Icon: FolderIcon, label: 'Workspace' },
            { to: '/progress', end: false, Icon: BoltIcon, label: 'Progress' },
          ].map(({ to, end, Icon, label }, i) => (
            <motion.div key={to} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07 + 0.1, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
              <NavLink to={to} end={end} className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}>
                {({ isActive }) => (
                  <>
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1">{label}</span>
                    {isActive && (
                      <span style={{ position: 'relative', width: '7px', height: '7px', display: 'flex', marginRight: '2px' }}>
                        <motion.span
                          style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#6366f1', opacity: 0.5 }}
                          animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
                          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        <span style={{ position: 'relative', width: '7px', height: '7px', borderRadius: '50%', background: '#818cf8', display: 'block' }} />
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            </motion.div>
          ))}

          <div className="mt-3 p-2.5 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Workspace Context</p>
            <div className="space-y-2">
              <select
                className="input"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                aria-label="Select active project"
              >
                <option value="">Local Project</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>{p.key} - {p.name}</option>
                ))}
              </select>
              <select
                className="input"
                value={selectedJiraProjectKey}
                onChange={(e) => setSelectedJiraProjectKey(e.target.value)}
                aria-label="Select Jira project"
              >
                <option value="">Select Jira Project</option>
                {jiraProjects.map((jp) => (
                  <option key={jp.id || jp.key} value={jp.key}>{jp.key} - {jp.name}</option>
                ))}
              </select>
              {activeProject && (
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Active: {activeProject.name}
                </p>
              )}
            </div>
          </div>
        </nav>

        {/* Bottom nav */}
        <div className="px-2.5 pb-2.5 space-y-0.5"
             style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
          <NavLink to="/settings" end={false} className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}>
            <CogIcon className="w-4 h-4 shrink-0" />
            <span>Settings</span>
          </NavLink>
          <button onClick={logout} className="sidebar-item w-full text-left"
                  onMouseEnter={e => { e.currentTarget.style.background='rgba(244,63,94,0.1)'; e.currentTarget.style.color='#fb7185'; }}
                  onMouseLeave={e => { e.currentTarget.style.background=''; e.currentTarget.style.color=''; }}>
            <ArrowRightOnRectangleIcon className="w-4 h-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>

        {/* User chip */}
        <div className="px-3 py-3 flex items-center gap-2.5 cursor-pointer"
             style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-hover)' }}>
          <div className="flex items-center justify-center shrink-0 text-xs font-bold text-white"
               style={{ width:'32px', height:'32px', borderRadius:'50%', background:'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow:'0 2px 8px rgba(99,102,241,0.35)' }}>
            {avatarLetter}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold truncate" style={{ color:'var(--text-primary)' }}>{user?.name}</p>
            <p className="text-[11px] capitalize" style={{ color:'var(--text-muted)' }}>{user?.role?.replace('_', ' ')}</p>
          </div>
          <ChevronUpDownIcon className="w-3.5 h-3.5 shrink-0" style={{ color:'#334155' }} />
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0" style={{ minWidth: 0 }}>
        {/* Top bar */}
        <header className="flex items-center px-5 gap-3 shrink-0"
                style={{ height:'52px', background:'var(--bg-header)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)', borderBottom:'1px solid var(--border)', boxShadow:'0 1px 0 rgba(255,255,255,0.03)' }}>
          <button className="lg:hidden p-1.5 rounded-lg transition-colors"
                  style={{ color:'#64748b' }}
                  onClick={() => setSidebarOpen(true)}>
            <Bars3Icon className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <ThemeToggle />
          <button className="relative flex items-center justify-center rounded-xl transition-all"
                  style={{ width:'36px', height:'36px', color:'#64748b' }}>
            <BellIcon style={{ width:'18px', height:'18px' }} />
            <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full" style={{ background:'#6366f1' }} />
          </button>
          <div className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl cursor-pointer transition-all ml-1"
               style={{ background:'var(--bg-card)', border:'1px solid var(--border-card)' }}>
            <div className="flex items-center justify-center font-bold text-white shrink-0"
                 style={{ width:'28px', height:'28px', borderRadius:'50%', fontSize:'11px', background:'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow:'0 2px 6px rgba(99,102,241,0.3)' }}>
              {avatarLetter}
            </div>
            <span className="hidden md:block text-[13px] font-medium" style={{ color:'var(--text-primary)' }}>{user?.name}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-page)' }}>
          <motion.div key={typeof window !== 'undefined' ? window.location.pathname : ''}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
            <Outlet />
          </motion.div>
        </main>
      </div>

      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div className="fixed inset-0 z-40 lg:hidden"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}
            style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(5px)' }}
            onClick={() => setSidebarOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
