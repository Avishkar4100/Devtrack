import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
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

const sprintStateBadgeClass = (state = '') => {
  const v = String(state).toLowerCase()
  if (v === 'active') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
  if (v === 'closed') return 'bg-slate-500/20 text-slate-300 border-slate-500/40'
  if (v === 'future') return 'bg-sky-500/20 text-sky-300 border-sky-500/40'
  return 'bg-slate-600/20 text-slate-300 border-slate-600/40'
}

const getCommitAuthor = (commit) => {
  if (typeof commit?.author === 'string' && commit.author.trim()) return commit.author
  if (commit?.author?.login) return commit.author.login
  if (commit?.commit?.author?.name) return commit.commit.author.name
  return 'Unknown'
}

const stripHtml = (value = '') => String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()

const adfNodeToText = (node) => {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(adfNodeToText).join('')

  const children = Array.isArray(node.content) ? node.content.map(adfNodeToText).join('') : ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'paragraph') return `${children}\n`
  if (node.type === 'bulletList' || node.type === 'orderedList') return `${children}\n`
  if (node.type === 'listItem') return `• ${children}`
  return children
}

const getIssueDescriptionText = (issue) => {
  const rendered = issue?.renderedFields?.description
  if (rendered && typeof rendered === 'string') {
    const cleaned = rendered
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<li>/gi, '• ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .trim()
    if (cleaned) return cleaned
  }

  const adf = issue?.fields?.description
  const fromAdf = adfNodeToText(adf).trim()
  if (fromAdf) return fromAdf

  return 'No description'
}

const getCustomFieldValue = (issue, possibleNames = [], fallbackKeys = []) => {
  const namesMap = issue?.names || {}
  const fields = issue?.fields || {}
  const wanted = possibleNames.map((n) => n.toLowerCase())

  for (const key of fallbackKeys) {
    if (fields[key] !== undefined && fields[key] !== null && fields[key] !== '') {
      return fields[key]
    }
  }

  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith('customfield_')) continue
    const label = String(namesMap[key] || '').toLowerCase()
    if (!label) continue
    if (wanted.some((n) => label.includes(n))) {
      if (value !== undefined && value !== null && value !== '') return value
    }
  }

  return null
}

const getDisplayName = (user) => {
  if (!user) return 'None'
  return user.displayName || user.name || user.emailAddress || (user.accountId ? `User ${String(user.accountId).slice(-6)}` : 'None')
}

const formatDateTime = (value) => {
  if (!value) return 'None'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'None'
  return d.toLocaleString()
}

const getDueDateMeta = (dueDate) => {
  if (!dueDate) return { label: 'None', overdue: false }
  const d = new Date(dueDate)
  if (Number.isNaN(d.getTime())) return { label: 'None', overdue: false }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(d)
  due.setHours(0, 0, 0, 0)
  const overdue = due < today

  return {
    label: d.toLocaleDateString(),
    overdue,
  }
}

const markdownComponents = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-200">{children}</em>,
  ul: ({ children }) => <ul className="mb-2 ml-5 list-disc space-y-1 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-5 list-decimal space-y-1 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  a: ({ href, children }) => (
    <a className="text-indigo-300 underline underline-offset-2 hover:text-indigo-200" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  code: ({ inline, children }) => (
    inline ? (
      <code className="rounded bg-slate-800 px-1 py-0.5 text-[0.85em] text-slate-100">{children}</code>
    ) : (
      <code className="block overflow-auto rounded-md border border-slate-700 bg-slate-950 p-3 text-xs text-slate-100">{children}</code>
    )
  ),
  blockquote: ({ children }) => <blockquote className="mb-2 border-l-2 border-slate-600 pl-3 text-slate-400 last:mb-0">{children}</blockquote>,
}

export default function WorkspacePage() {
  const qc = useQueryClient()
  const { selectedProjectId, selectedJiraProjectKey, projects } = useProjectStore()
  const [activeTab, setActiveTab] = useState('active-sprints')
  const [selectedBacklogIssueKey, setSelectedBacklogIssueKey] = useState('')
  const [activityView, setActivityView] = useState('all')
  const [isIssueEditMode, setIsIssueEditMode] = useState(false)
  const [issueDraft, setIssueDraft] = useState({ summary: '', description: '', priority: '', issueType: '', dueDate: '', labels: '' })
  const [newSubtaskSummary, setNewSubtaskSummary] = useState('')
  const [newLinkedIssueKey, setNewLinkedIssueKey] = useState('')
  const [newCommentBody, setNewCommentBody] = useState('')
  const [editingCommentId, setEditingCommentId] = useState('')
  const [editingCommentBody, setEditingCommentBody] = useState('')
  const [selectedCommitSha, setSelectedCommitSha] = useState('')

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

  const { data: commitPayload } = useQuery({
    queryKey: ['workspace-commits', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => {
      const response = await api.get(`/github/commits/${selectedProjectId}`, { params: { fetchAll: true } })
      return {
        commits: response?.data?.data || [],
        meta: response?.data?.meta || null,
      }
    },
  })

  const commits = commitPayload?.commits || []
  const commitFetchMeta = commitPayload?.meta || null

  const sortedCommits = useMemo(() => (
    [...(commits || [])].sort((a, b) => {
      const aTime = new Date(a?.commit?.author?.date || a?.commit?.committer?.date || a?.date || a?.createdAt || 0).getTime()
      const bTime = new Date(b?.commit?.author?.date || b?.commit?.committer?.date || b?.date || b?.createdAt || 0).getTime()
      return bTime - aTime
    })
  ), [commits])

  useEffect(() => {
    if (!sortedCommits.length) {
      setSelectedCommitSha('')
      return
    }

    if (!selectedCommitSha || !sortedCommits.some((commit) => commit.sha === selectedCommitSha)) {
      setSelectedCommitSha(sortedCommits[0]?.sha || '')
    }
  }, [sortedCommits, selectedCommitSha])

  const {
    data: selectedCommitDetail,
    isLoading: isCommitDetailLoading,
    isFetching: isCommitDetailFetching,
  } = useQuery({
    queryKey: ['workspace-commit-detail', selectedProjectId, selectedCommitSha],
    enabled: activeTab === 'development' && !!selectedProjectId && !!selectedCommitSha,
    queryFn: async () => (await api.get(`/github/commits/${selectedProjectId}/${selectedCommitSha}`)).data.data,
  })

  const selectedCommitTokenEstimate = useMemo(() => {
    if (!selectedCommitDetail) return 0

    const filePatches = (selectedCommitDetail.files || [])
      .map((file) => file?.patch || '')
      .join('\n')

    const baseText = [
      selectedCommitDetail.commit?.message || '',
      selectedCommitDetail.commit?.author?.name || '',
      filePatches,
    ].join('\n')

    return Math.max(0, Math.ceil(String(baseText).length / 4))
  }, [selectedCommitDetail])

  const { data: dashboard } = useQuery({
    queryKey: ['workspace-dashboard', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => (await api.get(`/dashboard/${selectedProjectId}`)).data.data,
  })

  const {
    data: jiraIssues = [],
    isLoading: isJiraIssuesLoading,
    isFetching: isJiraIssuesFetching,
  } = useQuery({
    queryKey: ['workspace-jira-issues', selectedJiraProjectKey],
    enabled: !!selectedJiraProjectKey,
    queryFn: async () =>
      (await api.get('/jira/server/issues', {
        params: {
          projectKey: selectedJiraProjectKey,
          fetchAll: true,
          maxResults: 200,
        },
      })).data.data?.issues || [],
  })

  const {
    data: selectedIssueDetail,
    isLoading: isIssueDetailLoading,
    isFetching: isIssueDetailFetching,
  } = useQuery({
    queryKey: ['workspace-jira-issue-detail', selectedBacklogIssueKey],
    enabled: activeTab === 'backlog' && !!selectedBacklogIssueKey,
    queryFn: async () => {
      const params = {
        expand: 'names,renderedFields,changelog',
        fields: [
          'summary',
          'description',
          'status',
          'issuetype',
          'assignee',
          'reporter',
          'labels',
          'parent',
          'duedate',
          'created',
          'updated',
          'priority',
          'subtasks',
          'issuelinks',
          'project',
          'comment',
          'worklog',
          'customfield_10016',
          'customfield_10020',
        ].join(','),
      }
      return (await api.get(`/jira/server/issues/${selectedBacklogIssueKey}`, { params })).data.data
    },
  })

  const { data: issueTransitions = [] } = useQuery({
    queryKey: ['workspace-jira-issue-transitions', selectedBacklogIssueKey],
    enabled: activeTab === 'backlog' && !!selectedBacklogIssueKey,
    queryFn: async () => (await api.get(`/jira/server/issues/${selectedBacklogIssueKey}/transitions`)).data.data || [],
  })

  useEffect(() => {
    setSelectedBacklogIssueKey('')
  }, [selectedJiraProjectKey])

  useEffect(() => {
    if (!Array.isArray(jiraIssues) || jiraIssues.length === 0) {
      setSelectedBacklogIssueKey('')
      return
    }

    if (!selectedBacklogIssueKey || !jiraIssues.some((issue) => issue.key === selectedBacklogIssueKey)) {
      setSelectedBacklogIssueKey(jiraIssues[0]?.key || '')
    }
  }, [jiraIssues, selectedBacklogIssueKey])

  const { data: jiraTeamMembers = [] } = useQuery({
    queryKey: ['workspace-jira-members', selectedJiraProjectKey],
    enabled: !!selectedJiraProjectKey,
    queryFn: async () => (await api.get(`/jira/server/projects/${selectedJiraProjectKey}/members`, { params: { includeApps: false } })).data.data?.members || [],
  })

  const { data: jiraSprintData } = useQuery({
    queryKey: ['workspace-jira-active-sprint', selectedJiraProjectKey],
    enabled: !!selectedJiraProjectKey,
    queryFn: async () => (await api.get(`/jira/server/projects/${selectedJiraProjectKey}/active-sprint`)).data.data,
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

  const refreshSelectedIssue = () => {
    qc.invalidateQueries({ queryKey: ['workspace-jira-issues', selectedJiraProjectKey] })
    qc.invalidateQueries({ queryKey: ['workspace-jira-issue-detail', selectedBacklogIssueKey] })
    qc.invalidateQueries({ queryKey: ['workspace-jira-issue-transitions', selectedBacklogIssueKey] })
  }

  const updateIssueMutation = useMutation({
    mutationFn: async (payload) => (await api.put(`/jira/server/issues/${selectedBacklogIssueKey}`, payload)).data,
    onSuccess: () => {
      toast.success('Issue updated')
      setIsIssueEditMode(false)
      refreshSelectedIssue()
    },
  })

  const deleteIssueMutation = useMutation({
    mutationFn: async () => (await api.delete(`/jira/server/issues/${selectedBacklogIssueKey}`)).data,
    onSuccess: () => {
      toast.success('Issue deleted')
      setSelectedBacklogIssueKey('')
      refreshSelectedIssue()
    },
  })

  const assignToMeMutation = useMutation({
    mutationFn: async () => (await api.post(`/jira/server/issues/${selectedBacklogIssueKey}/assign-me`)).data,
    onSuccess: () => {
      toast.success('Assigned to you')
      refreshSelectedIssue()
    },
  })

  const transitionIssueMutation = useMutation({
    mutationFn: async (transitionId) => (await api.post(`/jira/server/issues/${selectedBacklogIssueKey}/transitions`, { transitionId })).data,
    onSuccess: () => {
      toast.success('Status updated')
      refreshSelectedIssue()
    },
  })

  const addSubtaskMutation = useMutation({
    mutationFn: async () => (await api.post(`/jira/server/issues/${selectedBacklogIssueKey}/subtasks`, { summary: newSubtaskSummary })).data,
    onSuccess: () => {
      toast.success('Subtask added')
      setNewSubtaskSummary('')
      refreshSelectedIssue()
    },
  })

  const deleteSubtaskMutation = useMutation({
    mutationFn: async (subtaskKey) => (await api.delete(`/jira/server/issues/${selectedBacklogIssueKey}/subtasks/${subtaskKey}`)).data,
    onSuccess: () => {
      toast.success('Subtask deleted')
      refreshSelectedIssue()
    },
  })

  const addIssueLinkMutation = useMutation({
    mutationFn: async () => (await api.post(`/jira/server/issues/${selectedBacklogIssueKey}/links`, { linkedIssueKey: newLinkedIssueKey, linkTypeName: 'Relates' })).data,
    onSuccess: () => {
      toast.success('Link added')
      setNewLinkedIssueKey('')
      refreshSelectedIssue()
    },
  })

  const deleteIssueLinkMutation = useMutation({
    mutationFn: async (linkId) => (await api.delete(`/jira/server/issue-links/${linkId}`)).data,
    onSuccess: () => {
      toast.success('Link removed')
      refreshSelectedIssue()
    },
  })

  const addCommentMutation = useMutation({
    mutationFn: async () => (await api.post(`/jira/server/issues/${selectedBacklogIssueKey}/comments`, { body: newCommentBody })).data,
    onSuccess: () => {
      toast.success('Comment added')
      setNewCommentBody('')
      setActivityView('comments')
      refreshSelectedIssue()
    },
  })

  const updateCommentMutation = useMutation({
    mutationFn: async () => (await api.put(`/jira/server/issues/${selectedBacklogIssueKey}/comments/${editingCommentId}`, { body: editingCommentBody })).data,
    onSuccess: () => {
      toast.success('Comment updated')
      setEditingCommentId('')
      setEditingCommentBody('')
      refreshSelectedIssue()
    },
  })

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId) => (await api.delete(`/jira/server/issues/${selectedBacklogIssueKey}/comments/${commentId}`)).data,
    onSuccess: () => {
      toast.success('Comment deleted')
      refreshSelectedIssue()
    },
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

  const jiraActiveSprint = jiraSprintData?.activeSprint || null
  const jiraActiveSprintIssues = jiraSprintData?.activeIssues || []

  const jiraSprintTimeline = useMemo(() => {
    const sprintsData = Array.isArray(jiraSprintData?.sprints) ? jiraSprintData.sprints : []
    return [...sprintsData].sort((a, b) => {
      const aDate = new Date(a?.startDate || a?.createdDate || 0).getTime()
      const bDate = new Date(b?.startDate || b?.createdDate || 0).getTime()
      return bDate - aDate
    })
  }, [jiraSprintData])

  const jiraSprintsByState = useMemo(() => ({
    active: jiraSprintTimeline.filter((s) => String(s?.state).toLowerCase() === 'active'),
    future: jiraSprintTimeline.filter((s) => String(s?.state).toLowerCase() === 'future'),
    closed: jiraSprintTimeline.filter((s) => String(s?.state).toLowerCase() === 'closed'),
  }), [jiraSprintTimeline])

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
      const fallbackName = member.name || member.displayName || member.publicName || (member.accountId ? `User ${String(member.accountId).slice(-6)}` : 'Unknown Member')

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
          name: fallbackName,
          email: member.email || 'N/A',
          role: roleText,
          joinedAt: null,
          source: 'jira',
        })
      }
    })

    return [...map.values()]
  }, [teamMembers, jiraTeamMembers])

  const selectedIssue = selectedIssueDetail || null
  const selectedIssueFields = selectedIssue?.fields || {}
  const descriptionText = useMemo(() => getIssueDescriptionText(selectedIssue), [selectedIssue])

  useEffect(() => {
    if (!selectedIssue) {
      setIsIssueEditMode(false)
      return
    }

    setIssueDraft({
      summary: selectedIssueFields?.summary || '',
      description: descriptionText === 'No description' ? '' : descriptionText,
      priority: selectedIssueFields?.priority?.name || '',
      issueType: selectedIssueFields?.issuetype?.name || '',
      dueDate: selectedIssueFields?.duedate || '',
      labels: Array.isArray(selectedIssueFields?.labels) ? selectedIssueFields.labels.join(', ') : '',
    })
    setEditingCommentId('')
    setEditingCommentBody('')
  }, [selectedIssue, selectedIssueFields, descriptionText])

  const issueSubtasks = Array.isArray(selectedIssueFields?.subtasks) ? selectedIssueFields.subtasks : []
  const issueLinks = Array.isArray(selectedIssueFields?.issuelinks) ? selectedIssueFields.issuelinks : []

  const labels = Array.isArray(selectedIssueFields?.labels) ? selectedIssueFields.labels : []
  const storyPoints = getCustomFieldValue(selectedIssue, ['story point estimate', 'story points'])
  const teamValue = getCustomFieldValue(selectedIssue, ['team'])
  const startDateValue = getCustomFieldValue(selectedIssue, ['start date'])
  const sprintValue = getCustomFieldValue(selectedIssue, ['sprint'])

  const sprintName = Array.isArray(sprintValue)
    ? sprintValue.map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean).join(', ')
    : (typeof sprintValue === 'object' ? sprintValue?.name : sprintValue)

  const dueDateMeta = getDueDateMeta(selectedIssueFields?.duedate)

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
              Project: {projects.find((p) => p._id === selectedProjectId)?.name || 'Workspace project'}
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

      {!selectedProjectId && (
        <div className="card p-4 text-slate-400">Select a linked local project from the sidebar to load workspace data.</div>
      )}

      {selectedProjectId && activeTab === 'active-sprints' && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Active Sprint</h3>
            {jiraActiveSprint ? (
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="border border-slate-700 rounded-md p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{jiraActiveSprint.name || 'Active Sprint'}</p>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${sprintStateBadgeClass(jiraActiveSprint.state)}`}>
                      {jiraActiveSprint.state || 'active'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {formatDate(jiraActiveSprint.startDate)} - {formatDate(jiraActiveSprint.endDate)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Goal: {jiraActiveSprint.goal || 'N/A'}</p>
                  {jiraSprintData?.board?.name && (
                    <p className="text-[11px] text-slate-500 mt-2">Board: {jiraSprintData.board.name}</p>
                  )}
                </li>
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No active Jira sprint found for this project.</p>
            )}
          </div>
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Sprint Scope</h3>
            <ul className="space-y-2 text-sm text-slate-300 mb-3">
              <li className="flex items-center justify-between"><span>Issues In Active Sprint</span><span>{jiraActiveSprintIssues.length}</span></li>
              <li className="flex items-center justify-between"><span>In Progress (Project)</span><span>{jiraIssueStats.inProgress}</span></li>
              <li className="flex items-center justify-between"><span>Done (Project)</span><span>{jiraIssueStats.done}</span></li>
              <li className="flex items-center justify-between"><span>To Do (Project)</span><span>{jiraIssueStats.toDo}</span></li>
            </ul>
            <ul className="space-y-2 text-sm text-slate-300 max-h-44 overflow-auto">
              {jiraActiveSprintIssues.slice(0, 8).map((issue) => (
                <li key={issue.id || issue.key} className="border border-slate-700 rounded-md p-2">
                  <p className="font-medium">{issue.key} - {issue.fields?.summary}</p>
                  <p className="text-xs text-slate-400">{issue.fields?.status?.name || 'Unknown'} • {issue.fields?.assignee?.displayName || 'Unassigned'}</p>
                </li>
              ))}
              {jiraActiveSprintIssues.length === 0 && <li className="text-slate-400">No Jira issues in the active sprint.</li>}
            </ul>
          </div>
        </div>
      )}

      {selectedJiraProjectKey && activeTab === 'backlog' && (
        <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Backlog</h3>
            <p className="text-xs text-slate-400 mb-3">
              Jira project: {selectedJiraProjectKey} • Total issues: {jiraIssueStats.total}
              {isJiraIssuesFetching ? ' • Refreshing…' : ''}
            </p>

            {isJiraIssuesLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, idx) => (
                  <div key={idx} className="border border-slate-700 rounded-md p-3 animate-pulse">
                    <div className="h-4 w-2/3 bg-slate-700 rounded" />
                    <div className="h-3 w-1/2 bg-slate-800 rounded mt-2" />
                  </div>
                ))}
              </div>
            ) : (
              <ul className="space-y-2 text-sm text-slate-300 max-h-[44rem] overflow-auto pr-1">
                {jiraIssues.map((issue) => {
                  const isSelected = issue.key === selectedBacklogIssueKey
                  return (
                    <li key={issue.id || issue.key}>
                      <button
                        type="button"
                        onClick={() => setSelectedBacklogIssueKey(issue.key)}
                        className={`w-full text-left border rounded-md p-3 transition-all duration-200 ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-500/10 shadow-[0_0_0_1px_rgba(99,102,241,0.35)]'
                            : 'border-slate-700 bg-slate-900/40 hover:border-slate-500'
                        }`}
                      >
                        <p className="font-medium text-slate-100">{issue.key}</p>
                        <p className="text-sm text-slate-200 mt-0.5 line-clamp-2">{issue.fields?.summary || 'Untitled issue'}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {issue.fields?.issuetype?.name || 'Issue'} • {issue.fields?.status?.name || 'Unknown'} • {getDisplayName(issue.fields?.assignee)}
                        </p>
                      </button>
                    </li>
                  )
                })}
                {jiraIssues.length === 0 && <li className="text-slate-400">No Jira issues loaded for this project key.</li>}
              </ul>
            )}
          </div>

          <div className={`card p-4 transition-all duration-300 ease-out ${selectedBacklogIssueKey ? 'opacity-100 translate-x-0' : 'opacity-90 translate-x-1'}`}>
            {!selectedBacklogIssueKey && (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">
                Select an issue from backlog to view details.
              </div>
            )}

            {selectedBacklogIssueKey && (isIssueDetailLoading || !selectedIssue) && (
              <div className="space-y-4 animate-pulse">
                <div className="h-6 w-40 bg-slate-700 rounded" />
                <div className="h-8 w-3/4 bg-slate-800 rounded" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="h-20 bg-slate-800 rounded" />
                  <div className="h-20 bg-slate-800 rounded" />
                </div>
                <div className="h-28 bg-slate-800 rounded" />
                <div className="h-28 bg-slate-800 rounded" />
                <div className="h-28 bg-slate-800 rounded" />
              </div>
            )}

            {selectedIssue && !isIssueDetailLoading && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-400">{selectedIssueFields?.project?.key || selectedJiraProjectKey}</p>
                    <p className="text-lg font-semibold text-slate-100">{selectedIssue.key}</p>
                    {isIssueEditMode ? (
                      <input
                        type="text"
                        className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
                        value={issueDraft.summary}
                        onChange={(e) => setIssueDraft((prev) => ({ ...prev, summary: e.target.value }))}
                      />
                    ) : (
                      <h4 className="text-xl font-semibold text-slate-100 mt-1">{selectedIssueFields?.summary || 'Untitled issue'}</h4>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-xs px-2 py-1 rounded-full border border-slate-600 bg-slate-800 text-slate-200">
                      {selectedIssueFields?.status?.name || 'Unknown'}
                    </span>
                    <div className="flex gap-2">
                      {!isIssueEditMode ? (
                        <button type="button" className="btn-secondary text-xs" onClick={() => setIsIssueEditMode(true)}>Edit</button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() => {
                              const labels = issueDraft.labels
                                .split(',')
                                .map((v) => v.trim())
                                .filter(Boolean)
                              updateIssueMutation.mutate({
                                summary: issueDraft.summary,
                                description: issueDraft.description,
                                priority: issueDraft.priority || undefined,
                                issueType: issueDraft.issueType || undefined,
                                dueDate: issueDraft.dueDate || null,
                                labels,
                              })
                            }}
                            disabled={updateIssueMutation.isPending}
                          >
                            Save
                          </button>
                          <button type="button" className="btn-secondary text-xs" onClick={() => setIsIssueEditMode(false)}>Cancel</button>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn-secondary text-xs border-rose-500/40 text-rose-200 hover:bg-rose-500/10"
                        onClick={() => deleteIssueMutation.mutate()}
                        disabled={deleteIssueMutation.isPending}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 text-sm">
                  <div className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Issue Type</p>
                    {isIssueEditMode ? (
                      <input
                        type="text"
                        className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100"
                        value={issueDraft.issueType}
                        onChange={(e) => setIssueDraft((prev) => ({ ...prev, issueType: e.target.value }))}
                      />
                    ) : (
                      <p className="text-slate-100 mt-1">{selectedIssueFields?.issuetype?.name || 'Issue'}</p>
                    )}
                  </div>
                  <div className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Story Point Estimate</p>
                    <p className="text-slate-100 mt-1">{storyPoints ?? 'None'}</p>
                  </div>
                </div>

                <section className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                  <h5 className="text-sm font-semibold text-slate-100 mb-2">Status</h5>
                  <div className="flex flex-wrap gap-2">
                    {(issueTransitions || []).map((transition) => (
                      <button
                        key={transition.id}
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => transitionIssueMutation.mutate(transition.id)}
                        disabled={transitionIssueMutation.isPending}
                      >
                        {transition.name}
                      </button>
                    ))}
                    {(issueTransitions || []).length === 0 && <p className="text-xs text-slate-400">No status transitions available.</p>}
                  </div>
                </section>

                <section className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                  <h5 className="text-sm font-semibold text-slate-100 mb-2">Description</h5>
                  {isIssueEditMode ? (
                    <textarea
                      className="w-full min-h-28 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                      value={issueDraft.description}
                      onChange={(e) => setIssueDraft((prev) => ({ ...prev, description: e.target.value }))}
                    />
                  ) : (
                    <div className="text-sm leading-6 text-slate-300">
                      <ReactMarkdown components={markdownComponents}>{descriptionText}</ReactMarkdown>
                    </div>
                  )}
                </section>

                <section className="grid md:grid-cols-2 gap-3">
                  <div className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                    <h5 className="text-sm font-semibold text-slate-100 mb-2">Subtasks</h5>
                    {issueSubtasks.length > 0 ? (
                      <ul className="space-y-2 text-sm text-slate-300">
                        {issueSubtasks.map((st) => (
                          <li key={st.id || st.key} className="border border-slate-700 rounded p-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium">{st.key}</p>
                              <button
                                type="button"
                                className="text-[11px] text-rose-300 hover:text-rose-200"
                                onClick={() => deleteSubtaskMutation.mutate(st.key)}
                                disabled={deleteSubtaskMutation.isPending}
                              >
                                Delete
                              </button>
                            </div>
                            <p className="text-xs text-slate-400">{st.fields?.summary || 'No summary'}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400">No subtasks</p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                        placeholder="Add subtask"
                        value={newSubtaskSummary}
                        onChange={(e) => setNewSubtaskSummary(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => addSubtaskMutation.mutate()}
                        disabled={addSubtaskMutation.isPending || !newSubtaskSummary.trim()}
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                    <h5 className="text-sm font-semibold text-slate-100 mb-2">Linked Work Items</h5>
                    {issueLinks.length > 0 ? (
                      <ul className="space-y-2 text-sm text-slate-300">
                        {issueLinks.slice(0, 8).map((link) => {
                          const linked = link.outwardIssue || link.inwardIssue
                          return (
                            <li key={link.id || `${linked?.key || 'link'}-${link.type?.name || ''}`} className="border border-slate-700 rounded p-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-medium">{linked?.key || 'Linked issue'}</p>
                                {link.id && (
                                  <button
                                    type="button"
                                    className="text-[11px] text-rose-300 hover:text-rose-200"
                                    onClick={() => deleteIssueLinkMutation.mutate(link.id)}
                                    disabled={deleteIssueLinkMutation.isPending}
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                              <p className="text-xs text-slate-400">{linked?.fields?.summary || link.type?.name || 'Related item'}</p>
                            </li>
                          )
                        })}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400">No linked work items</p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                        placeholder="Add linked issue key (e.g. HOS-3)"
                        value={newLinkedIssueKey}
                        onChange={(e) => setNewLinkedIssueKey(e.target.value.toUpperCase())}
                      />
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => addIssueLinkMutation.mutate()}
                        disabled={addIssueLinkMutation.isPending || !newLinkedIssueKey.trim()}
                      >
                        Link
                      </button>
                    </div>
                  </div>
                </section>

                <section className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                  <h5 className="text-sm font-semibold text-slate-100 mb-3">Details</h5>
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-400">Assignee</p>
                      <p className="text-slate-100">{getDisplayName(selectedIssueFields?.assignee)}</p>
                      <button
                        type="button"
                        className="text-xs text-indigo-300 hover:text-indigo-200 mt-1"
                        onClick={() => assignToMeMutation.mutate()}
                        disabled={assignToMeMutation.isPending}
                      >
                        Assign to me
                      </button>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Labels</p>
                      {isIssueEditMode ? (
                        <input
                          type="text"
                          className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100"
                          value={issueDraft.labels}
                          onChange={(e) => setIssueDraft((prev) => ({ ...prev, labels: e.target.value }))}
                          placeholder="label1, label2"
                        />
                      ) : (
                        <p className="text-slate-100">{labels.length ? labels.join(', ') : 'None'}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Parent</p>
                      <p className="text-slate-100">{selectedIssueFields?.parent?.key ? `${selectedIssueFields.parent.key} ${selectedIssueFields.parent.fields?.summary || ''}`.trim() : 'None'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Due Date</p>
                      {isIssueEditMode ? (
                        <input
                          type="date"
                          className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100"
                          value={issueDraft.dueDate || ''}
                          onChange={(e) => setIssueDraft((prev) => ({ ...prev, dueDate: e.target.value }))}
                        />
                      ) : (
                        <p className={`${dueDateMeta.overdue ? 'text-rose-300' : 'text-slate-100'}`}>
                          {dueDateMeta.overdue ? `Overdue since ${dueDateMeta.label}` : dueDateMeta.label}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Team</p>
                      <p className="text-slate-100">{typeof teamValue === 'object' ? (teamValue?.name || stripHtml(JSON.stringify(teamValue))) : (teamValue || 'None')}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Start Date</p>
                      <p className="text-slate-100">{startDateValue ? formatDate(startDateValue) : 'None'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Sprint</p>
                      <p className="text-slate-100">{sprintName || 'None'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Reporter</p>
                      <p className="text-slate-100">{getDisplayName(selectedIssueFields?.reporter)}</p>
                    </div>
                  </div>
                </section>

                <section className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                  <h5 className="text-sm font-semibold text-slate-100 mb-2">Development</h5>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary text-xs">Open with VS Code</button>
                    <button type="button" className="btn-secondary text-xs">Create branch</button>
                    <button type="button" className="btn-secondary text-xs">Create commit</button>
                  </div>
                </section>

                <section className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                  <h5 className="text-sm font-semibold text-slate-100 mb-1">Automation</h5>
                  <p className="text-xs text-slate-400">Refresh to see recent runs.</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button type="button" className="btn-secondary text-xs">Refresh</button>
                    <button type="button" className="btn-secondary text-xs">Create new automation rule</button>
                  </div>
                </section>

                <section className="text-xs text-slate-400">
                  <p>Created {formatDateTime(selectedIssueFields?.created)}</p>
                  <p>Updated {formatDateTime(selectedIssueFields?.updated)}</p>
                </section>

                <section className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-sm font-semibold text-slate-100">Activity</h5>
                    {isIssueDetailFetching && <span className="text-[11px] text-slate-500">Refreshing…</span>}
                  </div>

                  <div className="flex flex-wrap gap-2 mb-3">
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'comments', label: `Comments (${selectedIssueFields?.comment?.total || 0})` },
                      { id: 'history', label: `History (${selectedIssue?.changelog?.total || 0})` },
                      { id: 'worklog', label: `Work log (${selectedIssueFields?.worklog?.total || 0})` },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActivityView(tab.id)}
                        className={`px-2 py-1 text-xs rounded border ${activityView === tab.id ? 'border-indigo-500 text-indigo-300 bg-indigo-500/10' : 'border-slate-700 text-slate-300'}`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {activityView === 'comments' && (
                    <ul className="space-y-2 text-sm text-slate-300">
                      <li className="border border-slate-700 rounded p-2 bg-slate-900/40">
                        <textarea
                          className="w-full min-h-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
                          placeholder="Add comment"
                          value={newCommentBody}
                          onChange={(e) => setNewCommentBody(e.target.value)}
                        />
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() => addCommentMutation.mutate()}
                            disabled={addCommentMutation.isPending || !newCommentBody.trim()}
                          >
                            Add comment
                          </button>
                        </div>
                      </li>
                      {(selectedIssueFields?.comment?.comments || []).slice(0, 12).map((c) => (
                        <li key={c.id} className="border border-slate-700 rounded p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-400">{getDisplayName(c.author)} • {formatDateTime(c.updated || c.created)}</p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="text-[11px] text-indigo-300 hover:text-indigo-200"
                                onClick={() => {
                                  setEditingCommentId(c.id)
                                  setEditingCommentBody(adfNodeToText(c.body).trim())
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="text-[11px] text-rose-300 hover:text-rose-200"
                                onClick={() => deleteCommentMutation.mutate(c.id)}
                                disabled={deleteCommentMutation.isPending}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          {editingCommentId === c.id ? (
                            <div className="mt-2">
                              <textarea
                                className="w-full min-h-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
                                value={editingCommentBody}
                                onChange={(e) => setEditingCommentBody(e.target.value)}
                              />
                              <div className="mt-2 flex justify-end gap-2">
                                <button type="button" className="btn-secondary text-xs" onClick={() => setEditingCommentId('')}>Cancel</button>
                                <button
                                  type="button"
                                  className="btn-secondary text-xs"
                                  onClick={() => updateCommentMutation.mutate()}
                                  disabled={updateCommentMutation.isPending || !editingCommentBody.trim()}
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="mt-1 whitespace-pre-wrap">{adfNodeToText(c.body).trim() || 'Comment'}</p>
                          )}
                        </li>
                      ))}
                      {(!selectedIssueFields?.comment?.comments || selectedIssueFields.comment.comments.length === 0) && <li className="text-slate-400">No comments yet.</li>}
                    </ul>
                  )}

                  {activityView === 'history' && (
                    <ul className="space-y-2 text-sm text-slate-300">
                      {(selectedIssue?.changelog?.histories || []).slice(0, 12).map((h) => (
                        <li key={h.id} className="border border-slate-700 rounded p-2">
                          <p className="text-xs text-slate-400">{getDisplayName(h.author)} • {formatDateTime(h.created)}</p>
                          <p className="mt-1 text-xs text-slate-300">{(h.items || []).map((it) => `${it.field}: ${it.fromString || 'empty'} → ${it.toString || 'empty'}`).join(' | ') || 'Updated issue'}</p>
                        </li>
                      ))}
                      {(!selectedIssue?.changelog?.histories || selectedIssue.changelog.histories.length === 0) && <li className="text-slate-400">No history yet.</li>}
                    </ul>
                  )}

                  {activityView === 'worklog' && (
                    <ul className="space-y-2 text-sm text-slate-300">
                      {(selectedIssueFields?.worklog?.worklogs || []).slice(0, 8).map((w) => (
                        <li key={w.id} className="border border-slate-700 rounded p-2">
                          <p className="text-xs text-slate-400">{getDisplayName(w.author)} • {formatDateTime(w.started || w.created)}</p>
                          <p className="mt-1">{w.timeSpent || 'Work logged'}</p>
                        </li>
                      ))}
                      {(!selectedIssueFields?.worklog?.worklogs || selectedIssueFields.worklog.worklogs.length === 0) && <li className="text-slate-400">No work log entries yet.</li>}
                    </ul>
                  )}

                  {activityView === 'all' && (
                    <div className="space-y-2 text-sm text-slate-300">
                      <p>Comments: {selectedIssueFields?.comment?.total || 0}</p>
                      <p>History Events: {selectedIssue?.changelog?.total || 0}</p>
                      <p>Work Logs: {selectedIssueFields?.worklog?.total || 0}</p>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedProjectId && activeTab === 'timeline' && (
        <div className="card p-4">
          <h3 className="text-base font-semibold mb-2">Sprint Timeline</h3>
          <p className="text-xs text-slate-400 mb-3">
            Jira-style sprint roadmap for {selectedJiraProjectKey || 'selected project'}
            {jiraSprintData?.board?.name ? ` • Board: ${jiraSprintData.board.name}` : ''}
          </p>

          <div className="space-y-4">
            {[
              { key: 'active', label: 'Active' },
              { key: 'future', label: 'Future' },
              { key: 'closed', label: 'Closed' },
            ].map((lane) => {
              const laneSprints = jiraSprintsByState[lane.key] || []
              return (
                <div key={lane.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-slate-200">{lane.label}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-700 text-slate-400">{laneSprints.length}</span>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {laneSprints.map((s) => (
                      <div key={s.id || s.name} className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-sm text-slate-200 truncate">{s.name}</p>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${sprintStateBadgeClass(s.state)}`}>
                            {s.state || lane.key}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{formatDate(s.startDate)} - {formatDate(s.endDate)}</p>
                        <p className="text-xs text-slate-500 mt-1">Goal: {s.goal || 'N/A'}</p>
                      </div>
                    ))}
                    {laneSprints.length === 0 && (
                      <div className="text-sm text-slate-500 border border-dashed border-slate-700 rounded-md p-3">No {lane.label.toLowerCase()} sprints.</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {jiraSprintTimeline.length === 0 && (
            <p className="text-sm text-slate-400 mt-3">No Jira sprint timeline found for this project.</p>
          )}
        </div>
      )}

      {selectedProjectId && activeTab === 'reports' && (
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
              <p className="text-sm text-slate-400">Workspace report metrics are unavailable until this Jira key is linked to a DevTrack project.</p>
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

      {selectedProjectId && activeTab === 'team-members' && (
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

            <div className="mt-4 pt-3 border-t border-slate-700">
              <h4 className="text-sm font-semibold text-slate-200 mb-2">Jira Contributor Activity</h4>
              <ul className="space-y-2 text-sm text-slate-300">
                {jiraIssueStats.assigneeDistribution.slice(0, 12).map((row) => (
                  <li key={row.name} className="flex items-center justify-between border border-slate-700 rounded-md p-2">
                    <span>{row.name}</span>
                    <span className="text-slate-400">{row.count} issues</span>
                  </li>
                ))}
                {jiraIssueStats.assigneeDistribution.length === 0 && <li className="text-slate-400">No Jira contributor activity yet.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {selectedProjectId && activeTab === 'development' && (
        <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Recent Commits</h3>
            {selectedProjectId && (
              <p className="text-xs text-slate-400 mb-2">
                Loaded {commitFetchMeta?.fetchedCount || sortedCommits.length} commits
                {commitFetchMeta?.repo ? ` from ${commitFetchMeta.repo}` : ''}
                {commitFetchMeta?.branch ? ` (${commitFetchMeta.branch})` : ''}
                {commitFetchMeta?.complete === false ? ' • More commits exist; increase backend page cap.' : ''}
              </p>
            )}
            {selectedProjectId ? (
              <ul className="space-y-2 text-sm text-slate-300 max-h-[72vh] overflow-auto pr-1">
                {sortedCommits.map((c) => {
                  const isSelected = c.sha === selectedCommitSha
                  return (
                    <li key={c.sha || c._id}>
                      <button
                        type="button"
                        onClick={() => setSelectedCommitSha(c.sha)}
                        className={`w-full text-left border rounded-md p-3 transition-all duration-200 ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-500/10 shadow-[0_0_0_1px_rgba(99,102,241,0.35)]'
                            : 'border-slate-700 bg-slate-900/40 hover:border-slate-500'
                        }`}
                      >
                        <p className="font-medium line-clamp-2">{c.commit?.message || c.message || 'Commit'}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {(c.sha || '').slice(0, 10)} • {getCommitAuthor(c)} • {formatDate(c.commit?.author?.date || c.date || c.createdAt)}
                        </p>
                      </button>
                    </li>
                  )
                })}
                {sortedCommits.length === 0 && <li className="text-slate-400">No commit data found for this project.</li>}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">Workspace GitHub activity unavailable until this Jira key is linked to a DevTrack project.</p>
            )}
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-base font-semibold">Commit Code View</h3>
              {selectedProjectId && selectedCommitSha && selectedCommitDetail && !isCommitDetailLoading && (
                <span className="text-[11px] px-2 py-1 rounded-full border border-slate-700 text-slate-300 bg-slate-900/60">
                  Approx tokens: {selectedCommitTokenEstimate}
                </span>
              )}
            </div>

            {!selectedProjectId && (
              <p className="text-sm text-slate-400">Select a linked project to inspect commit code changes.</p>
            )}

            {selectedProjectId && !selectedCommitSha && (
              <p className="text-sm text-slate-400">Select a commit on the left to load file-level code changes.</p>
            )}

            {selectedProjectId && selectedCommitSha && isCommitDetailLoading && (
              <div className="space-y-3 animate-pulse">
                <div className="h-6 w-1/3 bg-slate-700 rounded" />
                <div className="h-16 bg-slate-800 rounded" />
                <div className="h-32 bg-slate-800 rounded" />
              </div>
            )}

            {selectedProjectId && selectedCommitSha && selectedCommitDetail && !isCommitDetailLoading && (
              <div className="space-y-3 max-h-[72vh] overflow-auto pr-1">
                <div className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                  <p className="text-xs text-slate-400">Commit</p>
                  <p className="text-sm text-slate-100 break-all">{selectedCommitDetail.sha}</p>
                  <p className="text-sm text-slate-200 mt-2">{selectedCommitDetail.commit?.message || 'No commit message'}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {selectedCommitDetail.commit?.author?.name || getCommitAuthor(selectedCommitDetail)} • {formatDateTime(selectedCommitDetail.commit?.author?.date || selectedCommitDetail.commit?.committer?.date)}
                    {isCommitDetailFetching ? ' • Refreshing…' : ''}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Files changed: {selectedCommitDetail.files?.length || 0} • +{selectedCommitDetail.stats?.additions || 0} / -{selectedCommitDetail.stats?.deletions || 0}
                  </p>
                </div>

                <div className="text-xs text-slate-400">Changed Files and Patch</div>

                {(selectedCommitDetail.files || []).map((file) => (
                  <div key={file.sha || file.filename} className="border border-slate-700 rounded-md p-3 bg-slate-900/40">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-100 break-all">{file.filename}</p>
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-700 text-slate-300">
                        {file.status || 'modified'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">+{file.additions || 0} / -{file.deletions || 0}</p>

                    <div className="mt-2 rounded-md border border-slate-800 bg-black/50 p-2">
                      <pre className="text-[11px] leading-5 whitespace-pre-wrap break-words text-slate-200 font-mono">
                        {file.patch || 'No textual patch available for this file (binary or too large).'}
                      </pre>
                    </div>
                  </div>
                ))}

                {(!selectedCommitDetail.files || selectedCommitDetail.files.length === 0) && (
                  <p className="text-sm text-slate-400">No changed files were returned for this commit.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
