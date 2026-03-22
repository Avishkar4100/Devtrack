import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import toast from 'react-hot-toast'

export default function AdminOrganizationsPage() {
  const qc = useQueryClient()
  const [newOrg, setNewOrg] = useState({ name: '', domain: '', owner: '' })
  const [drafts, setDrafts] = useState({})

  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await api.get('/admin/users')).data.data,
  })

  const { data: orgs = [] } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: async () => (await api.get('/admin/organizations')).data.data,
  })

  const createOrg = useMutation({
    mutationFn: (body) => api.post('/admin/organizations', body),
    onSuccess: () => {
      toast.success('Organization created')
      setNewOrg({ name: '', domain: '', owner: '' })
      qc.invalidateQueries({ queryKey: ['admin-orgs'] })
      qc.invalidateQueries({ queryKey: ['admin-overview'] })
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to create organization'),
  })

  const updateOrg = useMutation({
    mutationFn: ({ id, body }) => api.put(`/admin/organizations/${id}`, body),
    onSuccess: () => {
      toast.success('Organization updated')
      qc.invalidateQueries({ queryKey: ['admin-orgs'] })
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to update organization'),
  })

  const deleteOrg = useMutation({
    mutationFn: (id) => api.delete(`/admin/organizations/${id}`),
    onSuccess: () => {
      toast.success('Organization deleted')
      qc.invalidateQueries({ queryKey: ['admin-orgs'] })
      qc.invalidateQueries({ queryKey: ['admin-overview'] })
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to delete organization'),
  })

  const getDraft = (org) => drafts[org._id] || {
    name: org.name || '',
    domain: org.domain || '',
    isActive: org.isActive,
  }

  const setDraftField = (orgId, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [orgId]: {
        ...(prev[orgId] || {}),
        [field]: value,
      },
    }))
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Organization Management</h1>
        <p className="text-sm text-slate-400">Provision and govern organizations across your platform.</p>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="text-base font-semibold text-gray-100">Create Organization</h2>
        <div className="grid md:grid-cols-3 gap-2">
          <input className="input" placeholder="Organization Name" value={newOrg.name} onChange={(e) => setNewOrg((s) => ({ ...s, name: e.target.value }))} />
          <input className="input" placeholder="Domain (example.com)" value={newOrg.domain} onChange={(e) => setNewOrg((s) => ({ ...s, domain: e.target.value }))} />
          <select className="input" value={newOrg.owner} onChange={(e) => setNewOrg((s) => ({ ...s, owner: e.target.value }))}>
            <option value="">Select owner</option>
            {users.map((u) => <option key={u._id} value={u._id}>{u.name} - {u.email}</option>)}
          </select>
        </div>
        <button className="btn-primary" onClick={() => createOrg.mutate(newOrg)} disabled={createOrg.isPending}>Create Organization</button>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="text-base font-semibold text-gray-100">All Organizations</h2>
        <div className="space-y-2 max-h-[420px] overflow-auto">
          {orgs.map((org) => {
            const draft = getDraft(org)
            return (
              <div key={org._id} className="border border-slate-700/70 rounded-lg p-3 flex items-center gap-3">
                <div className="flex-1 grid md:grid-cols-3 gap-2">
                  <input className="input" value={draft.name} onChange={(e) => setDraftField(org._id, 'name', e.target.value)} />
                  <input className="input" value={draft.domain} onChange={(e) => setDraftField(org._id, 'domain', e.target.value)} />
                  <select className="input" value={draft.isActive ? 'active' : 'inactive'} onChange={(e) => setDraftField(org._id, 'isActive', e.target.value === 'active')}>
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary btn-sm" onClick={() => updateOrg.mutate({ id: org._id, body: draft })}>Save</button>
                  <button className="btn-secondary btn-sm" onClick={() => deleteOrg.mutate(org._id)}>Delete</button>
                </div>
              </div>
            )
          })}
          {orgs.length === 0 && <p className="text-sm text-slate-400">No organizations yet.</p>}
        </div>
      </div>
    </div>
  )
}
