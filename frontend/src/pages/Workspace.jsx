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
  { id: 'team-members', label: 'Team Members', usage: 'Weekly / On Demand', primaryUser: 'Managers & Scrum Masters' },
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

  const { data: jiraTeamMembers = [] } = useQuery({
    queryKey: ['workspace-jira-members', selectedJiraProjectKey],
    enabled: !!selectedJiraProjectKey,
    queryFn: async () => (await api.get(`/jira/server/projects/${selectedJiraProjectKey}/members`, { params: { includeApps: false } })).data.data?.members || [],
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

  const jiraIssueStats = useMemo(() => {
    const buckets = {
      done: 0,
      inProgress: 0,
      toDo: 0,
      unassigned: 0,
    }

    const byType = new Map()
    const assigneeLoad = new Map()

    jiraIssues.forEach((issue) => {
      const statusName = (issue.fields?.status?.name || '').toLowerCase()
      const typeName = issue.fields?.issuetype?.name || 'Issue'
      const assigneeName = issue.fields?.assignee?.displayName || 'Unassigned'

      if (statusName.includes('done') || statusName.includes('closed') || statusName.includes('resolved')) {
        buckets.done += 1
      } else if (statusName.includes('progress') || statusName.includes('review') || statusName.includes('develop') || statusName.includes('test')) {
        buckets.inProgress += 1
      } else {
        buckets.toDo += 1
      }

      if (assigneeName === 'Unassigned') buckets.unassigned += 1

      byType.set(typeName, (byType.get(typeName) || 0) + 1)
      assigneeLoad.set(assigneeName, (assigneeLoad.get(assigneeName) || 0) + 1)
    })

    const activeIssues = jiraIssues.filter((issue) => {
      const statusName = (issue.fields?.status?.name || '').toLowerCase()
      return statusName.includes('progress') || statusName.includes('review') || statusName.includes('develop') || statusName.includes('test')
    })

    const recentActivity = [...jiraIssues]
      .sort((a, b) => new Date(b.fields?.updated || 0) - new Date(a.fields?.updated || 0))
      .slice(0, 8)

    const typeDistribution = [...byType.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)

    const assigneeDistribution = [...assigneeLoad.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    return {
      ...buckets,
      total: jiraIssues.length,
      activeIssues,
      recentActivity,
      typeDistribution,
      assigneeDistribution,
    }
  }, [jiraIssues])

  const commitsByAuthor = useMemo(() => {
    const map = new Map()
    commits.forEach((c) => {
      const author = getCommitAuthor(c)
      map.set(author, (map.get(author) || 0) + 1)
    })
    return [...map.entries()].map(([author, count]) => ({ author, count }))
  }, [commits])

  const teamMembers = useMemo(() => {
    const owner = project?.owner
      ? [{
          id: project.owner._id || 'owner',
          name: project.owner.name || 'Project Owner',
          email: project.owner.email || 'N/A',
          role: 'owner',
          joinedAt: project.createdAt,
        }]
      : []

    const members = (project?.members || []).map((member) => ({
      id: member?.user?._id || `${member?.user || ''}-${member?.joinedAt || ''}`,
      name: member?.user?.name || 'Unknown Member',
      email: member?.user?.email || 'N/A',
      role: member?.role || 'member',
      joinedAt: member?.joinedAt,
    }))

    return [...owner, ...members]
  }, [project])

  const combinedTeamMembers = useMemo(() => {
    const map = new Map()

    teamMembers.forEach((member) => {
      const key = member.email !== 'N/A' ? member.email : `local-${member.id}`
      map.set(key, {
        ...member,
        source: 'local',
      })
    })

    jiraTeamMembers.forEach((member) => {
      const roleText = Array.isArray(member.roles) && member.roles.length > 0
        ? member.roles.join(', ')
        : 'jira-member'
      const key = member.email && member.email !== 'N/A'
        ? member.email
        : member.accountId || `jira-${member.name}`

      if (map.has(key)) {
        const existing = map.get(key)
        map.set(key, {
          ...existing,
          role: existing.role === 'member' ? roleText : `${existing.role} / ${roleText}`,
          source: 'local+jira',
        })
      } else {
        map.set(key, {
          id: member.accountId || key,
          name: member.name || 'Unknown Member',
          email: member.email || 'N/A',
          role: roleText,
          joinedAt: null,
          source: 'jira',
        })
      }
    })

    return [...map.values()]
  }, [teamMembers, jiraTeamMembers])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Workspace</h1>
          <p className="text-sm text-slate-400">Jira-centric workspace with execution tabs for the selected project.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedProjectId && (
            <span className="text-xs px-2 py-1 rounded-md border border-slate-700 text-slate-300 bg-slate-900/60">
              Project: {projects.find((p) => p._id === selectedProjectId)?.name || 'Local project'}
            </span>
          )}
          <span className="text-xs px-2 py-1 rounded-md border border-slate-700 text-slate-300 bg-slate-900/60">
            Jira: {selectedJiraProjectKey || 'Not connected'}
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

      {!selectedProjectId && !selectedJiraProjectKey && (
        <div className="card p-4 text-slate-400">Select a local or Jira project from the sidebar to load workspace data.</div>
      )}

      {(selectedProjectId || selectedJiraProjectKey) && activeTab === 'active-sprints' && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Active Sprints</h3>
            {selectedProjectId ? (
              <ul className="space-y-2 text-sm text-slate-300">
                {activeSprints.map((s) => (
                  <li key={s._id} className="border border-slate-700 rounded-md p-2">
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-slate-400">{formatDate(s.startDate)} - {formatDate(s.endDate)} • Goal: {s.goal || 'N/A'}</p>
                  </li>
                ))}
                {activeSprints.length === 0 && <li className="text-slate-400">No active sprint.</li>}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No local sprint selected. Showing Jira active work in the next panel.</p>
            )}
          </div>
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Jira Active Work</h3>
            <ul className="space-y-2 text-sm text-slate-300 mb-3">
              <li className="flex items-center justify-between"><span>Total Issues</span><span>{jiraIssueStats.total}</span></li>
              <li className="flex items-center justify-between"><span>In Progress</span><span>{jiraIssueStats.inProgress}</span></li>
              <li className="flex items-center justify-between"><span>Done</span><span>{jiraIssueStats.done}</span></li>
              <li className="flex items-center justify-between"><span>To Do</span><span>{jiraIssueStats.toDo}</span></li>
            </ul>
            <ul className="space-y-2 text-sm text-slate-300 max-h-44 overflow-auto">
              {jiraIssueStats.activeIssues.slice(0, 5).map((issue) => (
                <li key={issue.id || issue.key} className="border border-slate-700 rounded-md p-2">
                  <p className="font-medium">{issue.key} - {issue.fields?.summary}</p>
                  <p className="text-xs text-slate-400">{issue.fields?.status?.name || 'Unknown'} • {issue.fields?.assignee?.displayName || 'Unassigned'}</p>
                </li>
              ))}
              {jiraIssueStats.activeIssues.length === 0 && <li className="text-slate-400">No Jira issues currently in progress.</li>}
            </ul>
          </div>
        </div>
      )}

      {(selectedProjectId || selectedJiraProjectKey) && activeTab === 'backlog' && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Local Backlog</h3>
            {selectedProjectId ? (
              <>
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
              </>
            ) : (
              <p className="text-sm text-slate-400">Local project not selected. Select a local project to view synced local backlog.</p>
            )}
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

      {(selectedProjectId || selectedJiraProjectKey) && activeTab === 'timeline' && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Local Timeline</h3>
            <p className="text-xs text-slate-400 mb-2">Project deadline: {formatDate(project?.deadline)}</p>
            {selectedProjectId ? (
              <ul className="space-y-2 text-sm text-slate-300">
                {sprintTimeline.map((s) => (
                  <li key={s._id} className="border border-slate-700 rounded-md p-2">
                    <p className="font-medium">{s.name} ({s.status})</p>
                    <p className="text-xs text-slate-400">{formatDate(s.startDate)} - {formatDate(s.endDate)}</p>
                  </li>
                ))}
                {sprintTimeline.length === 0 && <li className="text-slate-400">No sprint timeline available.</li>}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No local timeline data. Select a local project to see sprint plan.</p>
            )}
          </div>
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Jira Activity Timeline</h3>
            <p className="text-xs text-slate-400 mb-2">Latest updates from Jira issues</p>
            <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto">
              {jiraIssueStats.recentActivity.map((issue) => (
                <li key={issue.id || issue.key} className="border border-slate-700 rounded-md p-2">
                  <p className="font-medium">{issue.key} - {issue.fields?.summary}</p>
                  <p className="text-xs text-slate-400">Updated: {formatDate(issue.fields?.updated)} • {issue.fields?.status?.name || 'Unknown'}</p>
                </li>
              ))}
              {jiraIssueStats.recentActivity.length === 0 && <li className="text-slate-400">No Jira timeline activity found.</li>}
            </ul>
          </div>
        </div>
      )}

      {(selectedProjectId || selectedJiraProjectKey) && activeTab === 'reports' && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Velocity / Burndown Summary</h3>
            {selectedProjectId ? (
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex items-center justify-between"><span>Project Completion</span><span>{project?.completionPercentage ?? 0}%</span></li>
                <li className="flex items-center justify-between"><span>Active Sprint Velocity Planned</span><span>{dashboard?.activeSprint?.velocityPlanned ?? 0}</span></li>
                <li className="flex items-center justify-between"><span>Active Sprint Velocity Actual</span><span>{dashboard?.activeSprint?.velocityActual ?? 0}</span></li>
                <li className="flex items-center justify-between"><span>Burndown Points</span><span>{dashboard?.burndownData?.length ?? 0}</span></li>
              </ul>
            ) : (
              <p className="text-sm text-slate-400">Local report metrics are unavailable without a local project.</p>
            )}
          </div>
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Jira Delivery Health</h3>
            <ul className="space-y-2 text-sm text-slate-300">
              <li className="flex items-center justify-between"><span>Total Jira Issues</span><span>{jiraIssueStats.total}</span></li>
              <li className="flex items-center justify-between"><span>Done</span><span>{jiraIssueStats.done}</span></li>
              <li className="flex items-center justify-between"><span>In Progress</span><span>{jiraIssueStats.inProgress}</span></li>
              <li className="flex items-center justify-between"><span>To Do</span><span>{jiraIssueStats.toDo}</span></li>
              <li className="flex items-center justify-between"><span>Unassigned</span><span>{jiraIssueStats.unassigned}</span></li>
            </ul>
            <div className="mt-3 pt-3 border-t border-slate-700 text-sm text-slate-300">
              <p className="text-xs text-slate-400 mb-2">Issue Types</p>
              <ul className="space-y-1">
                {jiraIssueStats.typeDistribution.slice(0, 4).map((row) => (
                  <li key={row.type} className="flex items-center justify-between">
                    <span>{row.type}</span>
                    <span>{row.count}</span>
                  </li>
                ))}
                {jiraIssueStats.typeDistribution.length === 0 && <li className="text-slate-400">No Jira type distribution yet.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {(selectedProjectId || selectedJiraProjectKey) && activeTab === 'team-members' && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Team Members</h3>
            <p className="text-xs text-slate-400 mb-2">Combined local members and Jira project roles.</p>
            <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto">
              {combinedTeamMembers.map((member) => (
                <li key={member.id} className="border border-slate-700 rounded-md p-2">
                  <p className="font-medium">{member.name}</p>
                  <p className="text-xs text-slate-400">{member.email}</p>
                  <p className="text-xs text-slate-400">Role: {String(member.role).replace('_', ' ')}</p>
                  <p className="text-[11px] text-slate-500 mt-1">Source: {member.source}</p>
                </li>
              ))}
              {combinedTeamMembers.length === 0 && <li className="text-slate-400">No human team members found for this Jira project.</li>}
            </ul>
          </div>
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Team Summary</h3>
            <ul className="space-y-2 text-sm text-slate-300">
              <li className="flex items-center justify-between"><span>Total People</span><span>{combinedTeamMembers.length}</span></li>
              <li className="flex items-center justify-between"><span>Jira Contributors</span><span>{combinedTeamMembers.filter((m) => m.source.includes('jira')).length}</span></li>
              <li className="flex items-center justify-between"><span>Local Members</span><span>{combinedTeamMembers.filter((m) => m.source.includes('local')).length}</span></li>
              <li className="flex items-center justify-between"><span>Owner</span><span>{combinedTeamMembers.filter((m) => String(m.role).includes('owner')).length}</span></li>
            </ul>
            <div className="mt-3 border border-slate-700 rounded-md p-3 text-xs text-slate-400">
              Last joined: {formatDate(combinedTeamMembers.reduce((latest, m) => {
                if (!m.joinedAt) return latest
                if (!latest) return m.joinedAt
                return new Date(m.joinedAt) > new Date(latest) ? m.joinedAt : latest
              }, null))}
            </div>
          </div>
        </div>
      )}

      {(selectedProjectId || selectedJiraProjectKey) && activeTab === 'development' && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Recent Development Activity</h3>
            {selectedProjectId ? (
              <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto">
                {commits.map((c) => (
                  <li key={c._id || c.sha} className="border border-slate-700 rounded-md p-2">
                    <p className="font-medium">{c.message || c.commit?.message || 'Commit'}</p>
                    <p className="text-xs text-slate-400">{getCommitAuthor(c)} • {formatDate(c.createdAt || c.date || c.commit?.author?.date)}</p>
                  </li>
                ))}
                {commits.length === 0 && <li className="text-slate-400">No local commit data.</li>}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">Local GitHub activity unavailable. Select a local project to load commits.</p>
            )}
          </div>
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Jira Contributor Activity</h3>
            <ul className="space-y-2 text-sm text-slate-300">
              {jiraIssueStats.assigneeDistribution.slice(0, 8).map((row) => (
                <li key={row.name} className="flex items-center justify-between border border-slate-700 rounded-md p-2">
                  <span>{row.name}</span>
                  <span className="text-slate-400">{row.count} issues</span>
                </li>
              ))}
              {jiraIssueStats.assigneeDistribution.length === 0 && <li className="text-slate-400">No Jira contributor activity yet.</li>}
            </ul>
            {selectedProjectId && commitsByAuthor.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-700">
                <p className="text-xs text-slate-400 mb-2">Local Commit Contributors</p>
                <ul className="space-y-1 text-sm text-slate-300">
                  {commitsByAuthor.slice(0, 4).map((row) => (
                    <li key={row.author} className="flex items-center justify-between">
                      <span>{row.author}</span>
                      <span className="text-slate-400">{row.count} commits</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
