import { Outlet, NavLink } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { useProjectStore } from '@/store/projectStore'
import { useNotificationStore } from '@/store/notificationStore'
import api from '@/lib/api'
import {
  FolderIcon, CogIcon, ArrowRightOnRectangleIcon,
  BellIcon, ChevronUpDownIcon, Bars3Icon, XMarkIcon,
  BoltIcon,
  SparklesIcon,
  SunIcon, MoonIcon,
} from '@heroicons/react/24/outline'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '@/store/themeStore'

// Click-outside detector hook
function useClickOutside(ref, callback) {
  useEffect(() => {
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        callback()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [ref, callback])
}

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
  const notifications = useNotificationStore((state) => state.notifications)
  const markSeen = useNotificationStore((state) => state.markSeen)
  const markAllSeen = useNotificationStore((state) => state.markAllSeen)
  const clearNotifications = useNotificationStore((state) => state.clearNotifications)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const bellButtonRef = useRef(null)
  const notificationPanelRef = useRef(null)
  const [notificationPanelPos, setNotificationPanelPos] = useState({ top: 56, right: 16 })
  const lastProjectsSyncSigRef = useRef('')
  const avatarLetter = user?.name?.[0]?.toUpperCase()
  const unseenCount = notifications.filter((item) => !item.seen).length

  // Close notification panel on click outside
  useClickOutside(notificationPanelRef, () => {
    setNotificationOpen(false)
  })

  const { data: fetchedProjectsData } = useQuery({
    queryKey: ['layout-projects'],
    queryFn: async () => (await api.get('/projects')).data.data || [],
  })

  useEffect(() => {
    if (!Array.isArray(fetchedProjectsData)) return

    const nextSig = fetchedProjectsData.map((p) => p?._id || '').join('|')
    if (nextSig === lastProjectsSyncSigRef.current) return

    lastProjectsSyncSigRef.current = nextSig
    setProjects(fetchedProjectsData)
  }, [fetchedProjectsData, setProjects])

  const activeProject = useMemo(
    () => projects.find((p) => p._id === selectedProjectId) || null,
    [projects, selectedProjectId]
  )

  useEffect(() => {
    if (!activeProject) {
      if (selectedJiraProjectKey) {
        setSelectedJiraProjectKey('')
      }
      return
    }

    const connectedJiraKey = activeProject.jiraProjectKey || ''
    if (selectedJiraProjectKey !== connectedJiraKey) {
      setSelectedJiraProjectKey(connectedJiraKey)
    }
  }, [activeProject, selectedJiraProjectKey, setSelectedJiraProjectKey])

  const selectableProjects = useMemo(
    () => projects.filter((p) => Boolean(p?.jiraConnected && p?.jiraProjectKey && p?.githubConnected && p?.githubRepo)),
    [projects]
  )

  useEffect(() => {
    if (!selectedProjectId) return
    const stillSelectable = selectableProjects.some((p) => p._id === selectedProjectId)
    if (stillSelectable) return

    const fallbackProject = selectableProjects[0] || null
    const fallbackProjectId = fallbackProject?._id || ''
    const fallbackJiraKey = fallbackProject?.jiraProjectKey || ''

    if (fallbackProjectId) {
      if (selectedProjectId !== fallbackProjectId) {
        setSelectedProjectId(fallbackProjectId)
      }
      if (selectedJiraProjectKey !== fallbackJiraKey) {
        setSelectedJiraProjectKey(fallbackJiraKey)
      }
      return
    }

    if (selectedProjectId) {
      setSelectedProjectId('')
    }
    if (selectedJiraProjectKey) {
      setSelectedJiraProjectKey('')
    }
  }, [selectedProjectId, selectableProjects, setSelectedProjectId, setSelectedJiraProjectKey])

  useEffect(() => {
    if (!notificationOpen) return

    const updatePanelPosition = () => {
      const btn = bellButtonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      const panelWidth = Math.min(360, window.innerWidth - 24)
      const top = rect.bottom + 8
      const left = Math.max(12, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 12))
      setNotificationPanelPos({ top, right: Math.max(12, window.innerWidth - (left + panelWidth)) })
    }

    updatePanelPosition()
    window.addEventListener('resize', updatePanelPosition)
    window.addEventListener('scroll', updatePanelPosition, true)

    return () => {
      window.removeEventListener('resize', updatePanelPosition)
      window.removeEventListener('scroll', updatePanelPosition, true)
    }
  }, [notificationOpen])

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
            { to: '/projects', end: false, Icon: FolderIcon, label: 'Projects' },
            { to: '/ai-planner', end: false, Icon: SparklesIcon, label: 'AI Planner' },
            { to: '/workspace', end: false, Icon: FolderIcon, label: 'Workspace' },
            { to: '/insights', end: false, Icon: BoltIcon, label: 'Delivery Insights' },
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
                aria-label="Select workspace project"
              >
                <option value="">Select Linked Workspace Project</option>
                {selectableProjects.map((p) => (
                  <option key={p._id} value={p._id}>{p.key} - {p.name}</option>
                ))}
              </select>
              <div className="rounded-md border border-slate-700 bg-slate-900/50 px-2 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <p>Jira: {activeProject?.jiraProjectKey || 'Not linked'}</p>
                <p>GitHub: {activeProject?.githubRepo || 'Not linked'}</p>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Only local projects linked with Jira and GitHub can be selected.
              </p>
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
          <div className="relative">
            <button
              ref={bellButtonRef}
              className="relative flex items-center justify-center rounded-xl transition-all"
              style={{ width:'36px', height:'36px', color:'#64748b' }}
              onClick={() => setNotificationOpen((prev) => !prev)}
              title="Notifications"
            >
              <BellIcon style={{ width:'18px', height:'18px' }} />
              {unseenCount > 0 && (
                <>
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ background:'#6366f1' }} />
                  <span
                    className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold flex items-center justify-center"
                    style={{ background: '#ef4444', color: '#fff' }}
                  >
                    {unseenCount > 99 ? '99+' : unseenCount}
                  </span>
                </>
              )}
            </button>

            {notificationOpen && createPortal(
              <div
                ref={notificationPanelRef}
                onMouseLeave={() => setNotificationOpen(false)}
                className="rounded-xl border shadow-xl"
                style={{
                  position: 'fixed',
                  top: `${notificationPanelPos.top}px`,
                  right: `${notificationPanelPos.right}px`,
                  width: '360px',
                  maxWidth: '92vw',
                  background: 'var(--bg-page)',
                  borderColor: 'var(--border-card)',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
                  zIndex: 99999,
                }}
              >
                <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-card)' }}>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Notifications</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{unseenCount} unseen</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      style={{ borderColor: 'var(--border-card)', color: 'var(--text-secondary)' }}
                      onClick={markAllSeen}
                    >
                      Mark all seen
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      style={{ borderColor: 'var(--border-card)', color: 'var(--text-secondary)' }}
                      onClick={clearNotifications}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="max-h-[340px] overflow-y-auto p-2 space-y-2">
                  {notifications.length === 0 && (
                    <p className="text-sm px-2 py-6 text-center" style={{ color: 'var(--text-muted)' }}>No notifications yet.</p>
                  )}

                  {notifications.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => markSeen(item.id)}
                      className="w-full text-left rounded-lg border px-3 py-2 transition"
                      style={{
                        borderColor: 'var(--border-card)',
                        background: item.seen ? 'transparent' : 'rgba(99,102,241,0.12)',
                        opacity: item.seen ? 0.58 : 1,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold" style={{ color: item.type === 'error' ? '#f87171' : item.type === 'success' ? '#34d399' : 'var(--text-secondary)' }}>
                          {item.title}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {new Date(item.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{item.message}</p>
                    </button>
                  ))}
                </div>
              </div>,
              document.body
            )}
          </div>
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
