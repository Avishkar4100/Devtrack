import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { useProjectStore } from '@/store/projectStore'

export default function JiraControlPage() {
  const qc = useQueryClient()
  const { currentProject } = useProjectStore()

  const [activeProjectKey, setActiveProjectKey] = useState('')
  const [projectForm, setProjectForm] = useState({ key: '', name: '', description: '' })
  const [issueForm, setIssueForm] = useState({ summary: '', description: '', issueType: 'Story', priority: 'Medium' })
  const [editingIssue, setEditingIssue] = useState(null)
  const [rawRequest, setRawRequest] = useState({ method: 'get', path: '/myself', body: '' })
  const [rawResponse, setRawResponse] = useState(null)

  const { data: jiraProjects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ['jira-server-projects'],
    queryFn: async () => {
      const { data } = await api.get('/jira/server/projects')
      return data.data || []
    },
  })

  const projectKeys = useMemo(() => jiraProjects.map((p) => p.key), [jiraProjects])

  const { data: issuesData, refetch: refetchIssues, isFetching: loadingIssues } = useQuery({
    queryKey: ['jira-server-issues', activeProjectKey],
    enabled: Boolean(activeProjectKey),
    queryFn: async () => {
      const { data } = await api.get('/jira/server/issues', { params: { projectKey: activeProjectKey, maxResults: 100 } })
      return data.data
    },
  })

  const { data: aiSummary, refetch: refetchSummary, isFetching: loadingSummary } = useQuery({
    queryKey: ['jira-ai-summary', activeProjectKey],
    enabled: false,
    queryFn: async () => {
      const { data } = await api.get(`/jira/server/issues/summary/${activeProjectKey}`)
      return data.data
    },
  })

  const issues = issuesData?.issues || []

  const createProjectMutation = useMutation({
    mutationFn: (body) => api.post('/jira/server/projects', body),
    onSuccess: () => {
      toast.success('Jira project created')
      qc.invalidateQueries(['jira-server-projects'])
      setProjectForm({ key: '', name: '', description: '' })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create Jira project'),
  })

  const createIssueMutation = useMutation({
    mutationFn: (body) => api.post('/jira/server/issues', body),
    onSuccess: () => {
      toast.success('Jira issue created')
      refetchIssues()
      setIssueForm({ summary: '', description: '', issueType: 'Story', priority: 'Medium' })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create issue'),
  })

  const updateIssueMutation = useMutation({
    mutationFn: ({ key, body }) => api.put(`/jira/server/issues/${key}`, body),
    onSuccess: () => {
      toast.success('Jira issue updated')
      setEditingIssue(null)
      refetchIssues()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update issue'),
  })

  const deleteIssueMutation = useMutation({
    mutationFn: (key) => api.delete(`/jira/server/issues/${key}`),
    onSuccess: () => {
      toast.success('Jira issue deleted')
      refetchIssues()
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete issue'),
  })

  const connectCurrentProjectMutation = useMutation({
    mutationFn: (jiraProjectKey) => api.post(`/jira/connect/${currentProject._id}`, { jiraProjectKey }),
    onSuccess: () => toast.success('Current DevTrack project connected to Jira'),
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to connect current project'),
  })

  const syncCurrentProjectMutation = useMutation({
    mutationFn: () => api.post(`/jira/sync/${currentProject._id}`),
    onSuccess: ({ data }) => {
      toast.success(`Synced ${data.data.syncedEpics} epics and ${data.data.syncedStories} issues`)
      qc.invalidateQueries(['stories', currentProject._id])
      qc.invalidateQueries(['epics', currentProject._id])
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to sync Jira to workspace'),
  })

  const proxyMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        method: rawRequest.method,
        path: rawRequest.path,
      }
      if (rawRequest.body.trim()) payload.data = JSON.parse(rawRequest.body)
      const { data } = await api.post('/jira/server/proxy', payload)
      return data.data
    },
    onSuccess: (data) => {
      setRawResponse(data)
      toast.success('Jira API request successful')
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Jira API request failed')
    },
  })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Jira Control Center</h1>
        <p className="text-sm text-gray-400">Two-way Jira integration: read, create, update, delete, and sync with DevTrack.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-4 space-y-3">
          <h2 className="text-base font-semibold text-gray-100">Jira Projects</h2>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="Project Key (ABC)" value={projectForm.key} onChange={(e) => setProjectForm((p) => ({ ...p, key: e.target.value.toUpperCase() }))} />
            <input className="input" placeholder="Project Name" value={projectForm.name} onChange={(e) => setProjectForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <textarea className="input resize-none" rows={2} placeholder="Description (optional)" value={projectForm.description} onChange={(e) => setProjectForm((p) => ({ ...p, description: e.target.value }))} />
          <button className="btn-primary" disabled={createProjectMutation.isPending || !projectForm.key || !projectForm.name} onClick={() => createProjectMutation.mutate(projectForm)}>
            {createProjectMutation.isPending ? 'Creating...' : 'Create Jira Project'}
          </button>
          <div className="max-h-48 overflow-y-auto border border-slate-700 rounded-lg">
            {loadingProjects ? <p className="p-3 text-sm text-gray-400">Loading projects...</p> : jiraProjects.map((p) => (
              <button key={p.id} className={`w-full text-left px-3 py-2 text-sm border-b border-slate-800 ${activeProjectKey === p.key ? 'bg-indigo-950/40 text-indigo-300' : 'text-slate-200'}`} onClick={() => setActiveProjectKey(p.key)}>
                {p.key} - {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <h2 className="text-base font-semibold text-gray-100">Current Workspace Project Sync</h2>
          <p className="text-sm text-gray-400">Selected workspace project: {currentProject?.name || 'None selected'}</p>
          <select className="input" value={activeProjectKey} onChange={(e) => setActiveProjectKey(e.target.value)}>
            <option value="">Select Jira project key</option>
            {projectKeys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <div className="flex gap-2">
            <button
              className="btn-secondary flex-1"
              disabled={!currentProject || !activeProjectKey || connectCurrentProjectMutation.isPending}
              onClick={() => connectCurrentProjectMutation.mutate(activeProjectKey)}
            >
              {connectCurrentProjectMutation.isPending ? 'Connecting...' : 'Connect Workspace Project'}
            </button>
            <button
              className="btn-primary flex-1"
              disabled={!currentProject || syncCurrentProjectMutation.isPending}
              onClick={() => syncCurrentProjectMutation.mutate()}
            >
              {syncCurrentProjectMutation.isPending ? 'Syncing...' : 'Pull Jira -> DevTrack'}
            </button>
          </div>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="text-base font-semibold text-gray-100">Create Jira Issue</h2>
        <div className="grid lg:grid-cols-4 gap-2">
          <select className="input" value={activeProjectKey} onChange={(e) => setActiveProjectKey(e.target.value)}>
            <option value="">Project Key</option>
            {projectKeys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <select className="input" value={issueForm.issueType} onChange={(e) => setIssueForm((s) => ({ ...s, issueType: e.target.value }))}>
            <option>Story</option>
            <option>Task</option>
            <option>Bug</option>
            <option>Epic</option>
            <option>Sub-task</option>
          </select>
          <select className="input" value={issueForm.priority} onChange={(e) => setIssueForm((s) => ({ ...s, priority: e.target.value }))}>
            <option>Highest</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
            <option>Lowest</option>
          </select>
          <button
            className="btn-primary"
            disabled={!activeProjectKey || !issueForm.summary || createIssueMutation.isPending}
            onClick={() => createIssueMutation.mutate({ ...issueForm, projectKey: activeProjectKey })}
          >
            {createIssueMutation.isPending ? 'Creating...' : 'Create Issue'}
          </button>
        </div>
        <input className="input" placeholder="Summary" value={issueForm.summary} onChange={(e) => setIssueForm((s) => ({ ...s, summary: e.target.value }))} />
        <textarea className="input resize-none" rows={3} placeholder="Description" value={issueForm.description} onChange={(e) => setIssueForm((s) => ({ ...s, description: e.target.value }))} />
      </div>

      {activeProjectKey && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-100">AI Jira Summary ({activeProjectKey})</h2>
            <button className="btn-secondary btn-sm" onClick={() => refetchSummary()}>
              {loadingSummary ? 'Refreshing...' : 'Refresh AI Summary'}
            </button>
          </div>
          <p className="text-sm text-slate-200">{aiSummary?.summary || 'No AI summary yet.'}</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs uppercase text-rose-300 mb-1">Top Risks</p>
              <ul className="text-xs text-slate-300 list-disc pl-5 space-y-1">
                {(aiSummary?.topRisks || []).map((r, idx) => <li key={`${r}-${idx}`}>{r}</li>)}
              </ul>
            </div>
            <div>
              <p className="text-xs uppercase text-emerald-300 mb-1">Next Actions</p>
              <ul className="text-xs text-slate-300 list-disc pl-5 space-y-1">
                {(aiSummary?.nextActions || []).map((a, idx) => <li key={`${a}-${idx}`}>{a}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100">Issues ({activeProjectKey || 'Select project'})</h2>
          <button className="btn-secondary btn-sm" disabled={!activeProjectKey || loadingIssues} onClick={() => refetchIssues()}>
            {loadingIssues ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {issues.map((i) => {
            const isEditing = editingIssue?.key === i.key
            return (
              <div key={i.id} className="border border-slate-700 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-slate-200 font-medium">{i.key} - {i.fields?.summary}</p>
                  <div className="flex gap-2">
                    <button className="btn-secondary btn-sm" onClick={() => setEditingIssue({ key: i.key, summary: i.fields?.summary || '', description: '', priority: i.fields?.priority?.name || 'Medium' })}>Edit</button>
                    <button className="btn-ghost btn-sm" onClick={() => deleteIssueMutation.mutate(i.key)}>Delete</button>
                  </div>
                </div>
                <p className="text-xs text-slate-400">{i.fields?.issuetype?.name} | {i.fields?.status?.name} | {i.fields?.priority?.name}</p>

                {isEditing && (
                  <div className="space-y-2">
                    <input className="input" value={editingIssue.summary} onChange={(e) => setEditingIssue((s) => ({ ...s, summary: e.target.value }))} />
                    <textarea className="input resize-none" rows={2} placeholder="Description" value={editingIssue.description} onChange={(e) => setEditingIssue((s) => ({ ...s, description: e.target.value }))} />
                    <select className="input" value={editingIssue.priority} onChange={(e) => setEditingIssue((s) => ({ ...s, priority: e.target.value }))}>
                      <option>Highest</option>
                      <option>High</option>
                      <option>Medium</option>
                      <option>Low</option>
                      <option>Lowest</option>
                    </select>
                    <div className="flex gap-2">
                      <button className="btn-primary btn-sm" onClick={() => updateIssueMutation.mutate({ key: i.key, body: { summary: editingIssue.summary, description: editingIssue.description, priority: editingIssue.priority } })}>Save</button>
                      <button className="btn-secondary btn-sm" onClick={() => setEditingIssue(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {!activeProjectKey && <p className="text-sm text-slate-500">Select a Jira project key to load issues.</p>}
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="text-base font-semibold text-gray-100">Advanced Jira REST API Proxy</h2>
        <p className="text-xs text-slate-400">Send any Jira REST API call through backend credentials. Path should be under rest/api/3 (example: /myself, /project, /search).</p>
        <div className="grid lg:grid-cols-4 gap-2">
          <select className="input" value={rawRequest.method} onChange={(e) => setRawRequest((r) => ({ ...r, method: e.target.value }))}>
            <option value="get">GET</option>
            <option value="post">POST</option>
            <option value="put">PUT</option>
            <option value="patch">PATCH</option>
            <option value="delete">DELETE</option>
          </select>
          <input className="input lg:col-span-2" value={rawRequest.path} onChange={(e) => setRawRequest((r) => ({ ...r, path: e.target.value }))} />
          <button className="btn-primary" disabled={proxyMutation.isPending} onClick={() => proxyMutation.mutate()}>{proxyMutation.isPending ? 'Running...' : 'Run API Call'}</button>
        </div>
        <textarea className="input font-mono resize-none" rows={5} placeholder="JSON body (optional)" value={rawRequest.body} onChange={(e) => setRawRequest((r) => ({ ...r, body: e.target.value }))} />
        {rawResponse && (
          <pre className="text-xs p-3 rounded-lg overflow-auto border border-slate-700 bg-slate-950 text-slate-200">{JSON.stringify(rawResponse, null, 2)}</pre>
        )}
      </div>
    </div>
  )
}
