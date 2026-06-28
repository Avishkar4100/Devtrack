import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import toast from 'react-hot-toast'

const PROVIDER_LABELS = {
  openrouter: 'OpenRouter',
  deepseek_local: 'DeepSeek Local',
  deepseek_api: 'DeepSeek Official',
  manual_bridge: 'Manual Bridge',
}

const DEEPSEEK_OFFICIAL_MODELS = [
  { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
  { value: 'deepseek-chat', label: 'deepseek-chat (deprecated 2026-07-24)' },
  { value: 'deepseek-reasoner', label: 'deepseek-reasoner (deprecated 2026-07-24)' },
]

const normalizeDeepseekModels = (models) => (models || DEEPSEEK_OFFICIAL_MODELS).map((model) => (
  typeof model === 'string' ? { value: model, label: model } : model
))

const DEEPSEEK_OFFICIAL_DEFAULT_MAX_TOKENS = 120000
const MAX_TOKENS_LIMIT = 200000

export default function AdminControlPage() {
  const qc = useQueryClient()
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'manager' })

  const { data: overview } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: async () => (await api.get('/admin/overview')).data.data,
  })

  const { data: aiCfgData } = useQuery({
    queryKey: ['admin-ai-config'],
    queryFn: async () => (await api.get('/admin/ai-config')).data.data,
  })

  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await api.get('/admin/users')).data.data,
  })

  const [aiForm, setAiForm] = useState(null)

  const saveAI = useMutation({
    mutationFn: (body) => api.put('/admin/ai-config', body),
    onSuccess: () => { toast.success('AI config updated'); qc.invalidateQueries(['admin-ai-config']) },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to update AI config'),
  })

  const createUser = useMutation({
    mutationFn: (body) => api.post('/admin/users', body),
    onSuccess: () => { toast.success('User created'); setNewUser({ name: '', email: '', password: '', role: 'manager' }); qc.invalidateQueries(['admin-users']); qc.invalidateQueries(['admin-overview']) },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to create user'),
  })

  const deactivateUser = useMutation({
    mutationFn: (id) => api.delete(`/admin/users/${id}`),
    onSuccess: () => { toast.success('User deactivated'); qc.invalidateQueries(['admin-users']); qc.invalidateQueries(['admin-overview']) },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to deactivate user'),
  })

  const cfg = aiCfgData?.config
  const opts = aiCfgData?.options
  if (cfg && !aiForm) {
    setAiForm({
      provider: cfg.provider,
      openrouterKeyName: cfg.openrouterKeyName,
      openrouterModel: cfg.openrouterModel,
      deepseekUrl: cfg.deepseekUrl,
      deepseekModel: cfg.deepseekModel,
      deepseekThinking: cfg.deepseekThinking ?? true,
      deepseekReasoningEffort: cfg.deepseekReasoningEffort || 'high',
      temperature: cfg.temperature,
      maxTokens: cfg.provider === 'deepseek_api'
        ? Math.max(Number(cfg.maxTokens || 0), DEEPSEEK_OFFICIAL_DEFAULT_MAX_TOKENS)
        : cfg.maxTokens,
      manualBridgeTimeoutSeconds: cfg.manualBridgeTimeoutSeconds || opts?.manualBridgeDefaultTimeoutSeconds || 1800,
    })
  }

  const updateProvider = (provider) => {
    setAiForm((s) => ({
      ...s,
      provider,
      maxTokens: provider === 'deepseek_api'
        ? Math.max(Number(s.maxTokens || 0), DEEPSEEK_OFFICIAL_DEFAULT_MAX_TOKENS)
        : s.maxTokens,
    }))
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Admin Control Center</h1>
        <p className="text-sm text-slate-400">Manage AI providers, users, and live platform stats.</p>
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        <StatCard label="Total Users" value={overview?.users?.total || 0} />
        <StatCard label="Active Users" value={overview?.users?.active || 0} />
        <StatCard label="Total Projects" value={overview?.projects?.total || 0} />
        <StatCard label="Running Projects" value={overview?.projects?.running || 0} />
      </div>

      {aiForm && (
        <div className="card p-4 space-y-3">
          <h2 className="text-base font-semibold text-gray-100">AI Configuration</h2>
          <div className="grid md:grid-cols-3 gap-2">
            <select className="input" value={aiForm.provider} onChange={(e) => updateProvider(e.target.value)}>
              {opts?.providers?.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>)}
            </select>
            <select className="input" value={aiForm.openrouterKeyName} onChange={(e) => setAiForm((s) => ({ ...s, openrouterKeyName: e.target.value }))}>
              {(opts?.openrouterKeyNames || []).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input className="input" placeholder="OpenRouter Model" value={aiForm.openrouterModel} onChange={(e) => setAiForm((s) => ({ ...s, openrouterModel: e.target.value }))} />
            {aiForm.provider === 'deepseek_local' && (
              <input className="input" placeholder="DeepSeek URL" value={aiForm.deepseekUrl} onChange={(e) => setAiForm((s) => ({ ...s, deepseekUrl: e.target.value }))} />
            )}
            {aiForm.provider === 'deepseek_api' && (
              <>
                <select className="input" value={aiForm.deepseekModel} onChange={(e) => setAiForm((s) => ({ ...s, deepseekModel: e.target.value }))}>
                  {normalizeDeepseekModels(opts?.deepseekOfficialModels).map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <div className="text-xs text-slate-400 flex items-center">
                  Uses `DEEPSEEK_API_KEY` from `ai-service/.env`, `thinking`, `reasoning_effort`, and the official DeepSeek endpoint.
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={Boolean(aiForm.deepseekThinking)}
                    onChange={(e) => setAiForm((s) => ({ ...s, deepseekThinking: e.target.checked }))}
                  />
                  Thinking mode
                </label>
                <select className="input" value={aiForm.deepseekReasoningEffort} onChange={(e) => setAiForm((s) => ({ ...s, deepseekReasoningEffort: e.target.value }))}>
                  {(opts?.deepseekReasoningEffortOptions || ['high', 'max']).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </>
            )}
            {aiForm.provider === 'deepseek_local' && (
              <input className="input" placeholder="DeepSeek Model" value={aiForm.deepseekModel} onChange={(e) => setAiForm((s) => ({ ...s, deepseekModel: e.target.value }))} />
            )}
            <input className="input" type="number" placeholder="Temperature" value={aiForm.temperature} onChange={(e) => setAiForm((s) => ({ ...s, temperature: Number(e.target.value) }))} />
            <input
              className="input"
              type="number"
              min={aiForm.provider === 'deepseek_api' ? DEEPSEEK_OFFICIAL_DEFAULT_MAX_TOKENS : 128}
              max={MAX_TOKENS_LIMIT}
              step="1"
              placeholder="Max Tokens"
              value={aiForm.maxTokens}
              onChange={(e) => setAiForm((s) => ({ ...s, maxTokens: Number(e.target.value) }))}
            />
            <input className="input" type="number" placeholder="Manual Bridge Timeout (seconds)" value={aiForm.manualBridgeTimeoutSeconds} onChange={(e) => setAiForm((s) => ({ ...s, manualBridgeTimeoutSeconds: Number(e.target.value) }))} />
          </div>
          <button className="btn-primary" onClick={() => saveAI.mutate(aiForm)} disabled={saveAI.isPending}>{saveAI.isPending ? 'Saving...' : 'Save AI Configuration'}</button>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-4 space-y-3">
          <h2 className="text-base font-semibold text-gray-100">User Management</h2>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="Name" value={newUser.name} onChange={(e) => setNewUser((s) => ({ ...s, name: e.target.value }))} />
            <input className="input" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser((s) => ({ ...s, email: e.target.value }))} />
            <input className="input" type="password" placeholder="Password" value={newUser.password} onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))} />
            <select className="input" value={newUser.role} onChange={(e) => setNewUser((s) => ({ ...s, role: e.target.value }))}>
              <option value="admin">admin</option>
              <option value="scrum_master">scrum_master</option>
              <option value="manager">manager</option>
            </select>
          </div>
          <button className="btn-primary" onClick={() => createUser.mutate(newUser)} disabled={createUser.isPending}>Create User</button>
          <div className="max-h-64 overflow-y-auto space-y-2">
            {users.map((u) => (
              <div key={u._id} className="border border-slate-700 rounded-lg p-2 flex items-center justify-between">
                <p className="text-xs text-slate-200">{u.name} ({u.email}) - {u.role} - {u.isActive ? 'active' : 'inactive'}</p>
                <button className="btn-secondary btn-sm" onClick={() => deactivateUser.mutate(u._id)}>Deactivate</button>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <h2 className="text-base font-semibold text-gray-100">Workspace Provisioning</h2>
          <p className="text-sm text-slate-300">
            A personal organization workspace is auto-created when a user logs in.
            Users manage their own projects from the Projects section.
          </p>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-2xl text-slate-100 font-bold">{value}</p>
    </div>
  )
}
