import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import toast from 'react-hot-toast'

export default function AdminProjectsPage() {
  const qc = useQueryClient()
  const [newProject, setNewProject] = useState({ name: '', key: '', owner: '', status: 'planning' })
  const [drafts, setDrafts] = useState({})

  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await api.get('/admin/users')).data.data,
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['admin-projects'],
    queryFn: async () => (await api.get('/admin/projects')).data.data,
  })

  const createProject = useMutation({
    mutationFn: (body) => api.post('/admin/projects', body),
    onSuccess: () => {
      toast.success('Project created')
      setNewProject({ name: '', key: '', owner: '', status: 'planning' })
      qc.invalidateQueries({ queryKey: ['admin-projects'] })
      qc.invalidateQueries({ queryKey: ['admin-overview'] })
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to create project'),
  })

  const updateProject = useMutation({
    mutationFn: ({ id, body }) => api.put(`/admin/projects/${id}`, body),
    onSuccess: () => {
      toast.success('Project updated')
      qc.invalidateQueries({ queryKey: ['admin-projects'] })
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to update project'),
  })

  const deleteProject = useMutation({
    mutationFn: (id) => api.delete(`/admin/projects/${id}`),
    onSuccess: () => {
      toast.success('Project deleted')
      qc.invalidateQueries({ queryKey: ['admin-projects'] })
      qc.invalidateQueries({ queryKey: ['admin-overview'] })
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to delete project'),
  })

  const getDraft = (project) => drafts[project._id] || {
    name: project.name || '',
    key: (project.key || '').toUpperCase(),
    owner: project.owner?._id || project.owner || '',
    status: project.status || 'planning',
    technology: project.technology || '',
  }

  const setDraftField = (projectId, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [projectId]: {
        ...(prev[projectId] || {}),
        [field]: value,
      },
    }))
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Project Management</h1>
        <p className="text-sm text-slate-400">Admin-level project governance across all workspaces.</p>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="text-base font-semibold text-gray-100">Create Project</h2>
        <div className="grid md:grid-cols-4 gap-2">
          <input className="input" placeholder="Project Name" value={newProject.name} onChange={(e) => setNewProject((s) => ({ ...s, name: e.target.value }))} />
          <input className="input" placeholder="KEY" value={newProject.key} onChange={(e) => setNewProject((s) => ({ ...s, key: e.target.value.toUpperCase() }))} />
          <select className="input" value={newProject.owner} onChange={(e) => setNewProject((s) => ({ ...s, owner: e.target.value }))}>
            <option value="">Select owner</option>
            {users.map((u) => <option key={u._id} value={u._id}>{u.name} - {u.email}</option>)}
          </select>
          <select className="input" value={newProject.status} onChange={(e) => setNewProject((s) => ({ ...s, status: e.target.value }))}>
            <option value="planning">planning</option>
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="completed">completed</option>
            <option value="archived">archived</option>
          </select>
        </div>
        <button className="btn-primary" onClick={() => createProject.mutate(newProject)} disabled={createProject.isPending}>Create Project</button>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="text-base font-semibold text-gray-100">All Projects</h2>
        <div className="space-y-2 max-h-[500px] overflow-auto">
          {projects.map((project) => {
            const draft = getDraft(project)
            return (
              <div key={project._id} className="border border-slate-700/70 rounded-lg p-3 flex items-center gap-3">
                <div className="flex-1 grid md:grid-cols-5 gap-2">
                  <input className="input" value={draft.name} onChange={(e) => setDraftField(project._id, 'name', e.target.value)} />
                  <input className="input" value={draft.key} onChange={(e) => setDraftField(project._id, 'key', e.target.value.toUpperCase())} />
                  <select className="input" value={draft.owner} onChange={(e) => setDraftField(project._id, 'owner', e.target.value)}>
                    {users.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
                  </select>
                  <select className="input" value={draft.status} onChange={(e) => setDraftField(project._id, 'status', e.target.value)}>
                    <option value="planning">planning</option>
                    <option value="active">active</option>
                    <option value="paused">paused</option>
                    <option value="completed">completed</option>
                    <option value="archived">archived</option>
                  </select>
                  <input className="input" value={draft.technology} onChange={(e) => setDraftField(project._id, 'technology', e.target.value)} placeholder="Technology" />
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary btn-sm" onClick={() => updateProject.mutate({ id: project._id, body: draft })}>Save</button>
                  <button className="btn-secondary btn-sm" onClick={() => deleteProject.mutate(project._id)}>Delete</button>
                </div>
              </div>
            )
          })}
          {projects.length === 0 && <p className="text-sm text-slate-400">No projects found.</p>}
        </div>
      </div>
    </div>
  )
}
