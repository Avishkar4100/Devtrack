import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useProjectStore } from '@/store/projectStore'
import toast from 'react-hot-toast'

const INTERNAL_TABS = [
  { id: 'active-sprints', label: 'Active Sprints', usage: 'Every Day', primaryUser: 'Developers & QA' },
  { id: 'backlog', label: 'Backlog', usage: 'Weekly / Bi-weekly', primaryUser: 'Product Owners & Leads' },
  { id: 'timeline', label: 'Timeline', usage: 'Bi-weekly / Monthly', primaryUser: 'Project Managers' },
  { id: 'reports', label: 'Reports', usage: 'End of Sprint', primaryUser: 'Scrum Masters (Velocity/Burndown)' },
  { id: 'development', label: 'Development', usage: 'Occasionally', primaryUser: 'Tech Leads (Branch/Commit Status)' },
]

const formatDate = (value) => {
  if (!value) return 'N/A'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

const getCommitAuthor = (commit) => {
  if (typeof commit?.author === 'string' && commit.author.trim()) return commit.author
  if (commit?.author?.login) return commit.author.login
  if (commit?.commit?.author?.name) return commit.commit.author.name
  return 'Unknown'
}

export default function WorkspacePage() {
  const qc = useQueryClient()
  const { selectedProjectId, selectedJiraProjectKey, projects } = useProjectStore()
  const [activeTab, setActiveTab] = useState('active-sprints')

  const { data: project } = useQuery({
    queryKey: ['workspace-project', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => (await api.get(`/projects/${selectedProjectId}`)).data.data,
  })

  const { data: sprints = [] } = useQuery({
    queryKey: ['workspace-sprints', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => (await api.get(`/sprints/project/${selectedProjectId}`)).data.data || [],
  })

  const { data: stories = [] } = useQuery({
    queryKey: ['workspace-stories', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => (await api.get(`/stories/project/${selectedProjectId}`)).data.data || [],
  })

  const { data: epics = [] } = useQuery({
    queryKey: ['workspace-epics', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => (await api.get(`/stories/epics/${selectedProjectId}`)).data.data || [],
  })

  const { data: commits = [] } = useQuery({
    queryKey: ['workspace-commits', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => (await api.get(`/github/commits/${selectedProjectId}`)).data.data || [],
  })

  const { data: dashboard } = useQuery({
    queryKey: ['workspace-dashboard', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => (await api.get(`/dashboard/${selectedProjectId}`)).data.data,
  })

  const { data: jiraIssues = [] } = useQuery({
    queryKey: ['workspace-jira-issues', selectedJiraProjectKey],
    enabled: !!selectedJiraProjectKey,
    queryFn: async () => (await api.get('/jira/server/issues', { params: { projectKey: selectedJiraProjectKey, maxResults: 50 } })).data.data?.issues || [],
  })

  const syncFromJira = useMutation({
    mutationFn: async () => (await api.post(`/jira/sync/${selectedProjectId}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-stories', selectedProjectId] })
      qc.invalidateQueries({ queryKey: ['workspace-epics', selectedProjectId] })
      toast.success('Pulled latest backlog from Jira')
    },
  })

  const pushToJira = useMutation({
    mutationFn: async () => {
      const epicIds = epics.map((e) => e._id)
      const storyIds = stories.filter((s) => s.type !== 'subtask').map((s) => s._id)
      return (await api.post(`/jira/push/${selectedProjectId}`, { epicIds, storyIds })).data
    },
    onSuccess: () => toast.success('Pushed local backlog to Jira'),
  })

  const activeSprints = sprints.filter((s) => s.status === 'active')
  const sprintTimeline = [...sprints].sort((a, b) => new Date(a.startDate || a.createdAt) - new Date(b.startDate || b.createdAt))
  const doneCount = stories.filter((s) => s.status === 'done').length
  const inProgressCount = stories.filter((s) => s.status === 'in_progress').length
  const toDoCount = stories.filter((s) => s.status === 'to_do').length

  const commitsByAuthor = useMemo(() => {
    const map = new Map()
    commits.forEach((c) => {
      const author = getCommitAuthor(c)
      map.set(author, (map.get(author) || 0) + 1)
    })
    return [...map.entries()].map(([author, count]) => ({ author, count }))
  }, [commits])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Workspace</h1>
          <p className="text-sm text-slate-400">Jira-centric workspace with execution tabs for the selected project.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs px-2 py-1 rounded-md border border-slate-700 text-slate-300 bg-slate-900/60">
            Project: {projects.find((p) => p._id === selectedProjectId)?.name || 'Select from sidebar'}
          </span>
          <span className="text-xs px-2 py-1 rounded-md border border-slate-700 text-slate-300 bg-slate-900/60">
            Jira: {selectedJiraProjectKey || 'Select from sidebar'}
          </span>
          <button className="btn-secondary" onClick={() => pushToJira.mutate()} disabled={!selectedProjectId || pushToJira.isPending}>Push</button>
          <button className="btn-secondary" onClick={() => syncFromJira.mutate()} disabled={!selectedProjectId || syncFromJira.isPending}>Pull</button>
        </div>
      </div>

      <div className="card p-3 overflow-auto">
        <div className="flex flex-wrap gap-2">
          {INTERNAL_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-md border text-sm ${activeTab === tab.id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-900/50 border-slate-700 text-slate-300'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="mt-3 text-xs text-slate-400">
          {INTERNAL_TABS.find((t) => t.id === activeTab)?.usage} • {INTERNAL_TABS.find((t) => t.id === activeTab)?.primaryUser}
        </div>
      </div>

      {!selectedProjectId && <div className="card p-4 text-slate-400">Select a project to open Jira workspace tabs.</div>}

      {selectedProjectId && activeTab === 'active-sprints' && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Active Sprints</h3>
            <ul className="space-y-2 text-sm text-slate-300">
              {activeSprints.map((s) => (
                <li key={s._id} className="border border-slate-700 rounded-md p-2">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-slate-400">{formatDate(s.startDate)} - {formatDate(s.endDate)} • Goal: {s.goal || 'N/A'}</p>
                </li>
              ))}
              {activeSprints.length === 0 && <li className="text-slate-400">No active sprint.</li>}
            </ul>
          </div>
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Sprint Snapshot</h3>
            <ul className="space-y-2 text-sm text-slate-300">
              <li className="flex items-center justify-between"><span>Total Stories</span><span>{stories.length}</span></li>
              <li className="flex items-center justify-between"><span>Done</span><span>{doneCount}</span></li>
              <li className="flex items-center justify-between"><span>In Progress</span><span>{inProgressCount}</span></li>
              <li className="flex items-center justify-between"><span>To Do</span><span>{toDoCount}</span></li>
            </ul>
          </div>
        </div>
      )}

      {selectedProjectId && activeTab === 'backlog' && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Local Backlog</h3>
            <p className="text-xs text-slate-400 mb-2">Epics: {epics.length} • Stories/Tasks: {stories.length}</p>
            <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto">
              {stories.map((s) => (
                <li key={s._id} className="border border-slate-700 rounded-md p-2">
                  <p className="font-medium">{s.title}</p>
                  <p className="text-xs text-slate-400">{s.type} • {s.status} • {s.priority}</p>
                </li>
              ))}
              {stories.length === 0 && <li className="text-slate-400">No backlog items.</li>}
            </ul>
          </div>
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Jira Backlog</h3>
            <p className="text-xs text-slate-400 mb-2">Project key: {selectedJiraProjectKey || 'Not selected'}</p>
            <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto">
              {jiraIssues.map((issue) => (
                <li key={issue.id || issue.key} className="border border-slate-700 rounded-md p-2">
                  <p className="font-medium">{issue.key} - {issue.fields?.summary}</p>
                  <p className="text-xs text-slate-400">{issue.fields?.issuetype?.name || 'Issue'} • {issue.fields?.status?.name || 'Unknown'}</p>
                </li>
              ))}
              {jiraIssues.length === 0 && <li className="text-slate-400">No Jira issues loaded for this project key.</li>}
            </ul>
          </div>
        </div>
      )}

      {selectedProjectId && activeTab === 'timeline' && (
        <div className="card p-4">
          <h3 className="text-base font-semibold mb-2">Timeline</h3>
          <p className="text-xs text-slate-400 mb-2">Project deadline: {formatDate(project?.deadline)}</p>
          <ul className="space-y-2 text-sm text-slate-300">
            {sprintTimeline.map((s) => (
              <li key={s._id} className="border border-slate-700 rounded-md p-2">
                <p className="font-medium">{s.name} ({s.status})</p>
                <p className="text-xs text-slate-400">{formatDate(s.startDate)} - {formatDate(s.endDate)}</p>
              </li>
            ))}
            {sprintTimeline.length === 0 && <li className="text-slate-400">No sprint timeline available.</li>}
          </ul>
        </div>
      )}

      {selectedProjectId && activeTab === 'reports' && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Velocity / Burndown Summary</h3>
            <ul className="space-y-2 text-sm text-slate-300">
              <li className="flex items-center justify-between"><span>Project Completion</span><span>{project?.completionPercentage ?? 0}%</span></li>
              <li className="flex items-center justify-between"><span>Active Sprint Velocity Planned</span><span>{dashboard?.activeSprint?.velocityPlanned ?? 0}</span></li>
              <li className="flex items-center justify-between"><span>Active Sprint Velocity Actual</span><span>{dashboard?.activeSprint?.velocityActual ?? 0}</span></li>
              <li className="flex items-center justify-between"><span>Burndown Points</span><span>{dashboard?.burndownData?.length ?? 0}</span></li>
            </ul>
          </div>
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Delivery Health</h3>
            <ul className="space-y-2 text-sm text-slate-300">
              <li className="flex items-center justify-between"><span>Epics</span><span>{epics.length}</span></li>
              <li className="flex items-center justify-between"><span>Stories/Tasks</span><span>{stories.length}</span></li>
              <li className="flex items-center justify-between"><span>Done</span><span>{doneCount}</span></li>
              <li className="flex items-center justify-between"><span>In Progress</span><span>{inProgressCount}</span></li>
            </ul>
          </div>
        </div>
      )}

      {selectedProjectId && activeTab === 'development' && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Recent Commits</h3>
            <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto">
              {commits.map((c) => (
                <li key={c._id || c.sha} className="border border-slate-700 rounded-md p-2">
                  <p className="font-medium">{c.message || c.commit?.message || 'Commit'}</p>
                  <p className="text-xs text-slate-400">{getCommitAuthor(c)} • {formatDate(c.createdAt || c.date || c.commit?.author?.date)}</p>
                </li>
              ))}
              {commits.length === 0 && <li className="text-slate-400">No commit data.</li>}
            </ul>
          </div>
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Contributor Activity</h3>
            <ul className="space-y-2 text-sm text-slate-300">
              {commitsByAuthor.map((row) => (
                <li key={row.author} className="flex items-center justify-between border border-slate-700 rounded-md p-2">
                  <span>{row.author}</span>
                  <span className="text-slate-400">{row.count} commits</span>
                </li>
              ))}
              {commitsByAuthor.length === 0 && <li className="text-slate-400">No contributor stats yet.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
