import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, FolderIcon, MagnifyingGlassIcon, TrashIcon } from '@heroicons/react/24/outline'
import api from '@/lib/api'
import { useProjectStore } from '@/store/projectStore'
import { useAuthStore } from '@/store/authStore'
import { getProgressColor, formatDate, generateProjectKey } from '@/lib/utils'
import toast from 'react-hot-toast'
import { motion, AnimatePresence } from 'framer-motion'

const PROJECT_COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#3b82f6']

export default function ProjectsPage() {
  const qc = useQueryClient()
  const { setProjects, setCurrentProject } = useProjectStore()
  const { user } = useAuthStore()
  const isScrumMaster = user?.role === 'scrum_master'
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', key: '', color: '#6366f1', budget: '', deadline: '', technology: '', status: 'active' })

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data } = await api.get('/projects')
      setProjects(data.data)
      return data.data
    },
  })

  const createMutation = useMutation({
    mutationFn: (body) => api.post('/projects', body),
    onSuccess: () => {
      qc.invalidateQueries(['projects'])
      setShowCreate(false)
      resetForm()
      toast.success('Project created!')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries(['projects'])
      toast.success('Project deleted')
    },
  })

  const createTestMutation = useMutation({
    mutationFn: () => api.post('/projects', {
      name: 'Test Project',
      key: `TEST${Date.now().toString().slice(-4)}`,
      description: 'Temporary debug seed project',
      status: 'active',
    }),
    onSuccess: () => {
      qc.invalidateQueries(['projects'])
      toast.success('Test project created')
    },
  })

  const resetForm = () => setForm({ name: '', description: '', key: '', color: '#6366f1', budget: '', deadline: '', technology: '', status: 'active' })

  const handleNameChange = (name) => {
    setForm({ ...form, name, key: form.key || generateProjectKey(name) })
  }

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.key.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div className="flex items-center justify-between mb-6"
        initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#f3f4f6' }}>Projects</h1>
          <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>
            <span className="font-semibold" style={{ color: '#94a3b8' }}>{projects.length}</span>{' '}
            {projects.length === 1 ? 'project' : 'projects'}
          </p>
        </div>
        {isScrumMaster && (
          <motion.button onClick={() => setShowCreate(true)} className="btn-primary"
            whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
            <PlusIcon className="w-4 h-4" />
            New Project
          </motion.button>
        )}
      </motion.div>

      {/* Search */}
      <motion.div className="relative mb-6"
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.07, ease: [0.16, 1, 0.3, 1] }}>
        <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: '#475569' }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects by name or key…"
          className="input pl-10"
        />
      </motion.div>

      {/* Projects grid */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <motion.div key={i} className="card p-5 h-44"
              initial={{ opacity: 0 }} animate={{ opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.1 }}
              style={{ background: 'rgba(255,255,255,0.04)' }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <motion.div className="card p-16 text-center"
          initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
          <motion.div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(109,40,217,0.08))' }}
            animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
            <FolderIcon className="w-8 h-8" style={{ color: '#818cf8' }} />
          </motion.div>
          <p className="font-semibold mb-1" style={{ color: '#e2e8f0' }}>No projects found</p>
          <p className="text-sm mb-6" style={{ color: '#475569' }}>No projects available yet</p>
          <div className="flex gap-2 justify-center">
            {isScrumMaster && (
              <motion.button onClick={() => setShowCreate(true)} className="btn-primary"
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                <PlusIcon className="w-4 h-4" /> Create Project
              </motion.button>
            )}
            <motion.button onClick={() => createTestMutation.mutate()} className="btn-secondary"
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} disabled={createTestMutation.isPending}>
              {createTestMutation.isPending ? 'Creating...' : 'Create Test Project'}
            </motion.button>
          </div>
        </motion.div>
      ) : (
        <motion.div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
          initial="hidden" animate="show"
          variants={{ show: { transition: { staggerChildren: 0.07 } } }}>
          {filtered.map((project) => (
            <ProjectCard key={project._id} project={project}
              canDelete={isScrumMaster}
              onDelete={() => deleteMutation.mutate(project._id)}
              onSelect={() => setCurrentProject(project)} />
          ))}
        </motion.div>
      )}

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && isScrumMaster && (
          <Modal title="Create New Project" onClose={() => { setShowCreate(false); resetForm() }}>
            <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form) }} className="space-y-4">
              <div>
                <label className="input-label">Project Name *</label>
                <input type="text" value={form.name} onChange={(e) => handleNameChange(e.target.value)}
                  className="input" placeholder="e.g. Hospital Management System" required autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Project Key *</label>
                  <input type="text" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase().slice(0, 10) })}
                    className="input uppercase" placeholder="HMS" required />
                </div>
                <div>
                  <label className="input-label">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input">
                    <option value="planning">Planning</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="input-label">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="input resize-none" rows={2} placeholder="Brief project description..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Budget ($)</label>
                  <input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })}
                    className="input" placeholder="50000" />
                </div>
                <div>
                  <label className="input-label">Deadline</label>
                  <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="input" />
                </div>
              </div>
              <div>
                <label className="input-label">Technology Stack</label>
                <input type="text" value={form.technology} onChange={(e) => setForm({ ...form, technology: e.target.value })}
                  className="input" placeholder="React, Node.js, MongoDB..." />
              </div>
              <div>
                <label className="input-label">Project Color</label>
                <div className="flex gap-2 flex-wrap">
                  {PROJECT_COLORS.map((c) => (
                    <motion.button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                      whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.9 }}
                      className="w-8 h-8 rounded-lg border-2 transition-all"
                      style={{ backgroundColor: c, borderColor: form.color === c ? 'white' : 'transparent',
                        boxShadow: form.color === c ? `0 0 0 2px ${c}55` : 'none', transform: form.color === c ? 'scale(1.1)' : '' }} />
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowCreate(false); resetForm() }} className="btn-secondary flex-1">Cancel</button>
                <motion.button type="submit" disabled={createMutation.isPending} className="btn-primary flex-1"
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                  {createMutation.isPending ? 'Creating...' : 'Create Project'}
                </motion.button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  )
}

const ProjectCard = ({ project, onDelete, onSelect, canDelete }) => (
  <motion.div
    variants={{ hidden: { opacity: 0, y: 20, scale: 0.96 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } } }}
    whileHover={{ y: -4, boxShadow: `0 12px 40px ${project.color || '#6366f1'}20` }}
    className="card p-5 group relative cursor-default"
    style={{ transition: 'border-color 0.25s' }}
    onMouseEnter={e => e.currentTarget.style.borderColor = `${project.color || '#6366f1'}40`}
    onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}>
    <div className="flex items-start justify-between mb-3">
      <div className="flex items-center gap-3">
        <motion.div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
          style={{ backgroundColor: project.color || '#6366f1', boxShadow: `0 4px 12px ${project.color || '#6366f1'}40` }}
          whileHover={{ rotate: [0, -5, 5, 0], scale: 1.05 }}
          transition={{ duration: 0.4 }}>
          {project.key?.slice(0, 2)}
        </motion.div>
        <div>
          <p className="font-semibold text-sm leading-tight" style={{ color: '#e2e8f0' }}>{project.name}</p>
          <p className="text-xs font-medium" style={{ color: '#475569' }}>{project.key}</p>
        </div>
      </div>
      {canDelete && (
        <motion.button onClick={(e) => { e.preventDefault(); onDelete() }}
          className="btn-ghost btn-sm p-1 opacity-0 group-hover:opacity-100"
          style={{ color: '#f43f5e' }}
          whileHover={{ scale: 1.15, background: 'rgba(244,63,94,0.12)' }}
          whileTap={{ scale: 0.9 }}
          transition={{ duration: 0.15 }}>
          <TrashIcon className="w-4 h-4" />
        </motion.button>
      )}
    </div>

    <p className="text-xs mb-3 line-clamp-2 min-h-[2.5rem] leading-relaxed" style={{ color: '#475569' }}>
      {project.description || 'No description provided'}
    </p>

    <div className="mb-3">
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span style={{ color: '#64748b' }}>{project.completedStories} / {project.totalStories} stories</span>
        <span className="font-semibold" style={{ color: '#94a3b8' }}>{project.completionPercentage}%</span>
      </div>
      <div className="progress-bar">
        <motion.div className="progress-fill"
          initial={{ width: '0%' }}
          animate={{ width: `${project.completionPercentage}%` }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          style={{ background: project.color || 'linear-gradient(90deg, #6366f1, #8b5cf6)' }}
        />
      </div>
    </div>

    <div className="flex items-center justify-between pt-1">
      <div className="flex items-center gap-1.5">
        {project.jiraConnected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)' }}>Jira</span>
        )}
        {project.githubConnected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(255,255,255,0.06)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)' }}>GitHub</span>
        )}
      </div>
      <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
        <Link to={`/projects/${project._id}`} onClick={onSelect} className="btn-primary btn-sm text-xs">
          Open &rarr;
        </Link>
      </motion.div>
    </div>
  </motion.div>
)

const Modal = ({ title, children, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <motion.div className="absolute inset-0"
      style={{ background:'rgba(6,6,15,0.7)', backdropFilter:'blur(8px)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose} />
    <motion.div className="relative w-full max-w-lg card p-6 max-h-[90vh] overflow-y-auto"
      style={{ boxShadow:'0 24px 64px rgba(0,0,0,0.4)' }}
      initial={{ opacity: 0, scale: 0.94, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: 10 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-bold" style={{ color: '#f3f4f6' }}>{title}</h3>
        <motion.button onClick={onClose} className="btn-ghost btn-sm p-1.5 rounded-lg" style={{ color: '#64748b' }}
          whileHover={{ scale: 1.1, color: '#f3f4f6' }} whileTap={{ scale: 0.9 }}>✕</motion.button>
      </div>
      {children}
    </motion.div>
  </div>
)
