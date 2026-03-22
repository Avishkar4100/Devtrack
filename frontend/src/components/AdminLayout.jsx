import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useState } from 'react'
import {
  BoltIcon,
  XMarkIcon,
  Bars3Icon,
  ArrowRightOnRectangleIcon,
  HomeIcon,
  SparklesIcon,
  BuildingOffice2Icon,
  FolderIcon,
  BellIcon,
} from '@heroicons/react/24/outline'
import { motion, AnimatePresence } from 'framer-motion'

export default function AdminLayout() {
  const { user, logout } = useAuthStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const avatarLetter = user?.name?.[0]?.toUpperCase() || 'A'

  const adminNav = [
    { to: '/admin/overview', label: 'Overview', Icon: HomeIcon },
    { to: '/admin/ai-config', label: 'AI Config', Icon: SparklesIcon },
    { to: '/admin/organizations', label: 'Organizations', Icon: BuildingOffice2Icon },
    { to: '/admin/projects', label: 'Project Management', Icon: FolderIcon },
  ]

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-page)' }}>
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col transform transition-transform duration-300 lg:relative lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          width: '268px',
          background: 'linear-gradient(180deg, #09091a 0%, #070714 100%)',
          borderRight: '1px solid var(--border)',
          flexShrink: 0,
          boxShadow: '3px 0 24px rgba(0,0,0,0.45)',
        }}
      >
        <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div
            className="flex items-center justify-center shrink-0"
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '11px',
              background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
              boxShadow: '0 4px 14px rgba(99,102,241,0.45)',
            }}
          >
            <BoltIcon className="text-white" style={{ width: '18px', height: '18px' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-extrabold text-[15px] tracking-tight" style={{ color: 'var(--text-primary)' }}>
              DevTrack Admin
            </p>
            <p className="text-[11px] uppercase tracking-wider" style={{ color: '#818cf8' }}>
              Control Plane
            </p>
          </div>
          <button
            className="lg:hidden transition-colors rounded-lg p-1"
            style={{ color: '#64748b' }}
            onClick={() => setSidebarOpen(false)}
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto no-scrollbar space-y-1">
          {adminNav.map(({ to, label, Icon }, i) => (
            <motion.div
              key={to}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 + 0.08, duration: 0.3 }}
            >
              <NavLink to={to} className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}>
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{label}</span>
              </NavLink>
            </motion.div>
          ))}
        </nav>

        <div className="px-3 pb-3" style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
          <button
            onClick={logout}
            className="sidebar-item w-full text-left"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(244,63,94,0.1)'
              e.currentTarget.style.color = '#fb7185'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = ''
              e.currentTarget.style.color = ''
            }}
          >
            <ArrowRightOnRectangleIcon className="w-4 h-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>

        <div
          className="px-3 py-3 flex items-center gap-2.5"
          style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-hover)' }}
        >
          <div
            className="flex items-center justify-center shrink-0 text-xs font-bold text-white"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
            }}
          >
            {avatarLetter}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{user?.name}</p>
            <p className="text-[11px] uppercase tracking-wide" style={{ color: '#a5b4fc' }}>Administrator</p>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0" style={{ minWidth: 0 }}>
        <header
          className="flex items-center px-5 gap-3 shrink-0"
          style={{
            height: '56px',
            background: 'var(--bg-header)',
            borderBottom: '1px solid var(--border)',
            boxShadow: '0 1px 0 rgba(255,255,255,0.03)',
          }}
        >
          <button
            className="lg:hidden p-1.5 rounded-lg transition-colors"
            style={{ color: '#64748b' }}
            onClick={() => setSidebarOpen(true)}
          >
            <Bars3Icon className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <p className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Administration</p>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
              {location.pathname.replace('/admin/', '').replace('-', ' ').toUpperCase()}
            </p>
          </div>

          <div className="flex-1" />

          <button className="relative flex items-center justify-center rounded-xl" style={{ width: '36px', height: '36px', color: '#64748b' }}>
            <BellIcon style={{ width: '18px', height: '18px' }} />
            <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full" style={{ background: '#6366f1' }} />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-page)' }}>
          <Outlet />
        </main>
      </div>

      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            className="fixed inset-0 z-40 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(5px)' }}
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
