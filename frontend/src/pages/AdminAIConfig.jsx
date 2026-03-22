import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import toast from 'react-hot-toast'

const PROVIDER_LABELS = {
  openrouter: 'OpenRouter',
  deepseek_local: 'DeepSeek Local',
}

const defaultForm = {
  name: '',
  provider: 'openrouter',
  openrouterKeyName: 'OPENROUTER_API_KEY',
  openrouterModel: '',
  deepseekUrl: '',
  deepseekModel: 'deepseek-chat',
  temperature: 0.2,
  maxTokens: 2048,
}

const toForm = (cfg) => ({
  name: cfg.name || '',
  provider: cfg.provider || 'openrouter',
  openrouterKeyName: cfg.openrouterKeyName || 'OPENROUTER_API_KEY',
  openrouterModel: cfg.openrouterModel || '',
  deepseekUrl: cfg.deepseekUrl || '',
  deepseekModel: cfg.deepseekModel || 'deepseek-chat',
  temperature: cfg.temperature ?? 0.2,
  maxTokens: cfg.maxTokens ?? 2048,
})

export default function AdminAIConfigPage() {
  const qc = useQueryClient()
  const [aiForm, setAiForm] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [isCreating, setIsCreating] = useState(false)

  const { data: aiCfgData } = useQuery({
    queryKey: ['admin-ai-config'],
    queryFn: async () => (await api.get('/admin/ai-config')).data.data,
  })

  useEffect(() => {
    const configs = aiCfgData?.configs || []
    if (configs.length === 0) return

    const activeCfg = aiCfgData?.activeConfig || configs.find((c) => c.isActive) || configs[0]
    setSelectedId(activeCfg._id)
    setAiForm(toForm(activeCfg))
    setIsCreating(false)
  }, [aiCfgData])

  const createAI = useMutation({
    mutationFn: (body) => api.post('/admin/ai-config', body),
    onSuccess: () => {
      toast.success('AI configuration created')
      qc.invalidateQueries({ queryKey: ['admin-ai-config'] })
      setIsCreating(false)
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to create AI config'),
  })

  const saveAI = useMutation({
    mutationFn: ({ id, body }) => api.put(`/admin/ai-config/${id}`, body),
    onSuccess: () => {
      toast.success('AI config updated')
      qc.invalidateQueries({ queryKey: ['admin-ai-config'] })
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to update AI config'),
  })

  const activateAI = useMutation({
    mutationFn: (id) => api.put(`/admin/ai-config/${id}/activate`),
    onSuccess: () => {
      toast.success('Active AI configuration updated')
      qc.invalidateQueries({ queryKey: ['admin-ai-config'] })
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to activate AI config'),
  })

  const deleteAI = useMutation({
    mutationFn: (id) => api.delete(`/admin/ai-config/${id}`),
    onSuccess: () => {
      toast.success('AI configuration deleted')
      qc.invalidateQueries({ queryKey: ['admin-ai-config'] })
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to delete AI config'),
  })

  const opts = aiCfgData?.options
  const configs = aiCfgData?.configs || []

  const selectConfig = (cfg) => {
    setSelectedId(cfg._id)
    setAiForm(toForm(cfg))
    setIsCreating(false)
  }

  const startCreate = () => {
    setSelectedId(null)
    setAiForm({ ...defaultForm, openrouterModel: opts?.defaultOpenrouterModel || '' })
    setIsCreating(true)
  }

  const handleSave = () => {
    if (!aiForm?.name?.trim()) {
      toast.error('Config name is required')
      return
    }

    if (isCreating) {
      createAI.mutate(aiForm)
      return
    }

    if (!selectedId) {
      toast.error('Select a configuration to update')
      return
    }

    saveAI.mutate({ id: selectedId, body: aiForm })
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">AI Configuration</h1>
        <p className="text-sm text-slate-400">Create multiple AI profiles, edit them, and set exactly one active provider profile for platform usage.</p>
      </div>

      {aiForm && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-gray-100">AI Profiles</h2>
            <button className="btn-secondary btn-sm" onClick={startCreate}>New Profile</button>
          </div>

          <div className="space-y-2 max-h-52 overflow-auto">
            {configs.map((cfg) => (
              <div key={cfg._id} className={`border rounded-lg px-3 py-2 flex items-center gap-2 ${selectedId === cfg._id ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-slate-700/70'}`}>
                <button className="text-left flex-1" onClick={() => selectConfig(cfg)}>
                  <p className="text-sm text-slate-100 font-medium">{cfg.name}</p>
                  <p className="text-xs text-slate-400">{PROVIDER_LABELS[cfg.provider] || cfg.provider}</p>
                </button>
                {cfg.isActive && <span className="badge-approved">Active</span>}
                {!cfg.isActive && <button className="btn-secondary btn-sm" onClick={() => activateAI.mutate(cfg._id)}>Set Active</button>}
                <button className="btn-secondary btn-sm" onClick={() => deleteAI.mutate(cfg._id)}>Delete</button>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-2">
            <input className="input" placeholder="Configuration Name" value={aiForm.name} onChange={(e) => setAiForm((s) => ({ ...s, name: e.target.value }))} />
            <div className="text-xs text-slate-400 flex items-center px-1">
              {isCreating ? 'Creating new profile' : 'Editing selected profile'}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-2">
            <select className="input" value={aiForm.provider} onChange={(e) => setAiForm((s) => ({ ...s, provider: e.target.value }))}>
              {(opts?.providers || ['openrouter', 'deepseek_local']).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
              ))}
            </select>
            <div className="text-xs text-slate-400 flex items-center px-1">
              Selected provider: <span className="ml-1 font-semibold text-slate-200">{PROVIDER_LABELS[aiForm.provider] || aiForm.provider}</span>
            </div>
          </div>

          {aiForm.provider === 'openrouter' && (
            <div className="grid md:grid-cols-2 gap-2">
              <select className="input" value={aiForm.openrouterKeyName} onChange={(e) => setAiForm((s) => ({ ...s, openrouterKeyName: e.target.value }))}>
                {(opts?.openrouterKeyNames || []).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input className="input" placeholder="OpenRouter Model" value={aiForm.openrouterModel} onChange={(e) => setAiForm((s) => ({ ...s, openrouterModel: e.target.value }))} />
              <p className="text-xs text-slate-400 md:col-span-2">
                Key names like OPENROUTER_API_KEY_1 or OPENROUTER_API_KEY_2 are numbered env keys so you can switch between multiple API keys.
              </p>
            </div>
          )}

          {aiForm.provider === 'deepseek_local' && (
            <div className="grid md:grid-cols-2 gap-2">
              <input className="input" placeholder="DeepSeek URL" value={aiForm.deepseekUrl} onChange={(e) => setAiForm((s) => ({ ...s, deepseekUrl: e.target.value }))} />
              <input className="input" placeholder="DeepSeek Model" value={aiForm.deepseekModel} onChange={(e) => setAiForm((s) => ({ ...s, deepseekModel: e.target.value }))} />
              <p className="text-xs text-slate-400 md:col-span-2">
                DeepSeek Local uses your local/hosted endpoint URL and model name. OpenRouter key settings are hidden for this provider.
              </p>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-2">
            <input className="input" type="number" min="0" max="2" step="0.1" placeholder="Temperature" value={aiForm.temperature} onChange={(e) => setAiForm((s) => ({ ...s, temperature: Number(e.target.value) }))} />
            <input className="input" type="number" min="128" max="32768" step="1" placeholder="Max Tokens" value={aiForm.maxTokens} onChange={(e) => setAiForm((s) => ({ ...s, maxTokens: Number(e.target.value) }))} />
            <p className="text-xs text-slate-400 md:col-span-2">
              Temperature controls creativity (0 = deterministic, 1+ = more creative). Max Tokens is the response length limit.
            </p>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary" onClick={handleSave} disabled={saveAI.isPending || createAI.isPending}>
              {createAI.isPending || saveAI.isPending ? 'Saving...' : isCreating ? 'Create Profile' : 'Save Changes'}
            </button>
            {!isCreating && selectedId && (
              <button className="btn-secondary" onClick={() => activateAI.mutate(selectedId)} disabled={activateAI.isPending}>
                {activateAI.isPending ? 'Updating...' : 'Set As Active'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
