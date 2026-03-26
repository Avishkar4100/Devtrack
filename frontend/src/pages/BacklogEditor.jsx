import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { useWorkspaceStateStore } from '@/store/workspaceStateStore'

const DAY_MS = 24 * 60 * 60 * 1000

const toDateInput = (value) => {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

const defaultDates = () => {
  const start = new Date()
  const due = new Date(start.getTime() + (5 * DAY_MS))
  return {
    startDate: toDateInput(start),
    dueDate: toDateInput(due),
  }
}

const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const normalizeItem = (item = {}, type) => {
  const dates = defaultDates()
  return {
    ...item,
    tempId: item.tempId || makeId(type),
    title: item.title || '',
    description: item.description || '',
    type,
    module: item.module || 'core',
    priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium',
    assignee: item.assignee || '',
    status: 'todo',
    startDate: toDateInput(item.startDate) || dates.startDate,
    dueDate: toDateInput(item.dueDate) || dates.dueDate,
    storyPoints: Number(item.storyPoints || 0),
    parentId: item.parentId || null,
  }
}

const normalizeBacklog = (draft = {}) => {
  const epics = (draft.epics || []).map((e) => normalizeItem(e, 'epic'))
  const firstEpicId = epics[0]?.tempId || null

  const stories = (draft.stories || []).map((s) => {
    const row = normalizeItem(s, 'story')
    const epicTempId = s.epicTempId || s.parentId || firstEpicId
    return {
      ...row,
      epicTempId,
      parentId: epicTempId || null,
      acceptanceCriteria: Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria : [],
    }
  })

  const firstStoryId = stories[0]?.tempId || null

  const tasks = (draft.tasks || []).map((t) => {
    const row = normalizeItem(t, 'task')
    const parentTempId = t.parentTempId || t.parentId || firstStoryId
    const epicTempId = t.epicTempId || stories.find((s) => s.tempId === parentTempId)?.epicTempId || firstEpicId
    return {
      ...row,
      parentTempId,
      epicTempId,
      parentId: parentTempId || null,
      acceptanceCriteria: Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : [],
    }
  })

  const firstTaskId = tasks[0]?.tempId || null

  const subtasks = (draft.subtasks || []).map((st) => {
    const row = normalizeItem(st, 'subtask')
    const parentTempId = st.parentTempId || st.parentId || firstTaskId
    const epicTempId = st.epicTempId || tasks.find((t) => t.tempId === parentTempId)?.epicTempId || firstEpicId
    return {
      ...row,
      parentTempId,
      epicTempId,
      parentId: parentTempId || null,
      acceptanceCriteria: Array.isArray(st.acceptanceCriteria) ? st.acceptanceCriteria : [],
    }
  })

  return { epics, stories, tasks, subtasks }
}

export default function BacklogEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const workspaceState = useWorkspaceStateStore((s) => s.getProjectWorkspaceState(id))
  const setProjectWorkspaceState = useWorkspaceStateStore((s) => s.setProjectWorkspaceState)

  const initialDraft = useMemo(() => {
    const fromRoute = location.state?.generatedBacklog
    if (fromRoute) return normalizeBacklog(fromRoute)
    if (workspaceState?.generatedBacklogDraft) return normalizeBacklog(workspaceState.generatedBacklogDraft)
    return { epics: [], stories: [], tasks: [], subtasks: [] }
  }, [location.state, workspaceState])

  const [draft, setDraft] = useState(initialDraft)
  const [selected, setSelected] = useState({ type: 'epic', tempId: initialDraft.epics[0]?.tempId || '' })

  const { data: users = [] } = useQuery({
    queryKey: ['project-users', id],
    enabled: !!id,
    queryFn: async () => (await api.get(`/projects/${id}/users`)).data.data || [],
  })

  useEffect(() => {
    setProjectWorkspaceState(id, { generatedBacklogDraft: draft })
  }, [draft, id, setProjectWorkspaceState])

  const storiesByEpic = useMemo(() => {
    const map = new Map()
    draft.stories.forEach((s) => {
      const rows = map.get(s.epicTempId) || []
      rows.push(s)
      map.set(s.epicTempId, rows)
    })
    return map
  }, [draft.stories])

  const tasksByStory = useMemo(() => {
    const map = new Map()
    draft.tasks.forEach((t) => {
      const rows = map.get(t.parentTempId) || []
      rows.push(t)
      map.set(t.parentTempId, rows)
    })
    return map
  }, [draft.tasks])

  const subtasksByTask = useMemo(() => {
    const map = new Map()
    draft.subtasks.forEach((st) => {
      const rows = map.get(st.parentTempId) || []
      rows.push(st)
      map.set(st.parentTempId, rows)
    })
    return map
  }, [draft.subtasks])

  const allByType = {
    epic: draft.epics,
    story: draft.stories,
    task: draft.tasks,
    subtask: draft.subtasks,
  }

  const selectedItem = (allByType[selected.type] || []).find((x) => x.tempId === selected.tempId) || null

  const updateItem = (type, tempId, field, value) => {
    setDraft((prev) => ({
      ...prev,
      [`${type}s`]: prev[`${type}s`].map((item) => item.tempId === tempId ? { ...item, [field]: value } : item),
    }))
  }

  const addItem = (type, parent = null) => {
    const dates = defaultDates()
    const item = normalizeItem({
      tempId: makeId(type),
      title: `New ${type}`,
      module: selectedItem?.module || 'core',
      priority: 'medium',
      assignee: '',
      status: 'todo',
      startDate: dates.startDate,
      dueDate: dates.dueDate,
      storyPoints: 0,
    }, type)

    if (type === 'story') {
      item.epicTempId = parent || draft.epics[0]?.tempId || null
      item.parentId = item.epicTempId
      item.acceptanceCriteria = []
    }
    if (type === 'task') {
      item.parentTempId = parent || draft.stories[0]?.tempId || null
      item.parentId = item.parentTempId
      item.epicTempId = draft.stories.find((s) => s.tempId === item.parentTempId)?.epicTempId || draft.epics[0]?.tempId || null
      item.acceptanceCriteria = []
    }
    if (type === 'subtask') {
      item.parentTempId = parent || draft.tasks[0]?.tempId || null
      item.parentId = item.parentTempId
      item.epicTempId = draft.tasks.find((t) => t.tempId === item.parentTempId)?.epicTempId || draft.epics[0]?.tempId || null
      item.acceptanceCriteria = []
    }

    setDraft((prev) => ({
      ...prev,
      [`${type}s`]: [...prev[`${type}s`], item],
    }))
    setSelected({ type, tempId: item.tempId })
  }

  const deleteItem = (type, tempId) => {
    setDraft((prev) => {
      const next = { ...prev }
      if (type === 'epic') {
        next.epics = prev.epics.filter((e) => e.tempId !== tempId)
        const storyIds = prev.stories.filter((s) => s.epicTempId === tempId).map((s) => s.tempId)
        const taskIds = prev.tasks.filter((t) => t.epicTempId === tempId || storyIds.includes(t.parentTempId)).map((t) => t.tempId)
        next.stories = prev.stories.filter((s) => s.epicTempId !== tempId)
        next.tasks = prev.tasks.filter((t) => !taskIds.includes(t.tempId))
        next.subtasks = prev.subtasks.filter((st) => !taskIds.includes(st.parentTempId))
      } else if (type === 'story') {
        const taskIds = prev.tasks.filter((t) => t.parentTempId === tempId).map((t) => t.tempId)
        next.stories = prev.stories.filter((s) => s.tempId !== tempId)
        next.tasks = prev.tasks.filter((t) => t.parentTempId !== tempId)
        next.subtasks = prev.subtasks.filter((st) => !taskIds.includes(st.parentTempId))
      } else if (type === 'task') {
        next.tasks = prev.tasks.filter((t) => t.tempId !== tempId)
        next.subtasks = prev.subtasks.filter((st) => st.parentTempId !== tempId)
      } else {
        next.subtasks = prev.subtasks.filter((st) => st.tempId !== tempId)
      }
      return next
    })
    setSelected({ type: 'epic', tempId: draft.epics[0]?.tempId || '' })
  }

  const validateDraft = () => {
    if (draft.epics.length < 2) return 'Minimum 2 epics are required.'

    const hasEmpty = [...draft.epics, ...draft.stories, ...draft.tasks, ...draft.subtasks]
      .some((item) => !String(item.title || '').trim())
    if (hasEmpty) return 'All backlog items must have a title.'

    const epicIds = new Set(draft.epics.map((e) => e.tempId))
    const storyIds = new Set(draft.stories.map((s) => s.tempId))
    const taskIds = new Set(draft.tasks.map((t) => t.tempId))

    if (draft.stories.some((s) => !s.epicTempId || !epicIds.has(s.epicTempId))) return 'Found orphan story without epic link.'
    if (draft.tasks.some((t) => !t.parentTempId || !storyIds.has(t.parentTempId))) return 'Found orphan task without story link.'
    if (draft.subtasks.some((st) => !st.parentTempId || !taskIds.has(st.parentTempId))) return 'Found orphan subtask without task link.'

    const epicWithoutStories = draft.epics.some((e) => !draft.stories.some((s) => s.epicTempId === e.tempId))
    if (epicWithoutStories) return 'Each epic must contain at least one story.'

    const storyWithoutTasks = draft.stories.some((s) => !draft.tasks.some((t) => t.parentTempId === s.tempId))
    if (storyWithoutTasks) return 'Each story must contain at least one task.'

    return ''
  }

  const saveAndPush = useMutation({
    mutationFn: async () => {
      const validationError = validateDraft()
      if (validationError) throw new Error(validationError)

      await api.post(`/stories/save/${id}`, {
        epics: draft.epics,
        stories: draft.stories,
        tasks: draft.tasks,
        subtasks: draft.subtasks,
      })

      const freshEpics = (await api.get(`/stories/epics/${id}`)).data.data || []
      const freshStories = (await api.get(`/stories/project/${id}`)).data.data || []

      await api.post(`/jira/push/${id}`, {
        epicIds: freshEpics.map((e) => e._id),
        storyIds: freshStories.filter((s) => s.type !== 'subtask').map((s) => s._id),
      })
    },
    onSuccess: () => {
      toast.success('Backlog saved and pushed to Jira')
      navigate(`/projects/${id}`)
    },
    onError: (error) => toast.error(error?.message || 'Failed to save backlog'),
  })

  if (!draft.epics.length) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="card p-6 space-y-3">
          <h1 className="text-xl font-semibold">Backlog Editor</h1>
          <p className="text-sm text-slate-400">No generated backlog was found for this project. Generate backlog from AI Planner first.</p>
          <button className="btn-primary" onClick={() => navigate('/ai-planner')}>Go to AI Planner</button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">Backlog Editor</h1>
        <button className="btn-primary" onClick={() => saveAndPush.mutate()} disabled={saveAndPush.isPending}>
          {saveAndPush.isPending ? 'Saving...' : 'Save and Push to Jira'}
        </button>
      </div>

      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-3">
        <div className="card p-3 max-h-[76vh] overflow-auto space-y-2">
          {draft.epics.map((epic) => (
            <div key={epic.tempId} className="border border-slate-700 rounded-md p-2">
              <div className="flex items-center gap-2">
                <button className="text-left flex-1" onClick={() => setSelected({ type: 'epic', tempId: epic.tempId })}>EPIC: {epic.title}</button>
                <button className="text-xs btn-secondary" onClick={() => addItem('story', epic.tempId)}>+ Story</button>
                <button className="text-xs text-rose-300" onClick={() => deleteItem('epic', epic.tempId)}>Delete</button>
              </div>

              {(storiesByEpic.get(epic.tempId) || []).map((story) => (
                <div key={story.tempId} className="ml-4 mt-2 border border-slate-800 rounded p-2">
                  <div className="flex items-center gap-2">
                    <button className="text-left flex-1" onClick={() => setSelected({ type: 'story', tempId: story.tempId })}>STORY: {story.title}</button>
                    <button className="text-xs btn-secondary" onClick={() => addItem('task', story.tempId)}>+ Task</button>
                    <button className="text-xs text-rose-300" onClick={() => deleteItem('story', story.tempId)}>Delete</button>
                  </div>

                  {(tasksByStory.get(story.tempId) || []).map((task) => (
                    <div key={task.tempId} className="ml-4 mt-2 border border-slate-800 rounded p-2">
                      <div className="flex items-center gap-2">
                        <button className="text-left flex-1" onClick={() => setSelected({ type: 'task', tempId: task.tempId })}>TASK: {task.title}</button>
                        <button className="text-xs btn-secondary" onClick={() => addItem('subtask', task.tempId)}>+ Subtask</button>
                        <button className="text-xs text-rose-300" onClick={() => deleteItem('task', task.tempId)}>Delete</button>
                      </div>

                      {(subtasksByTask.get(task.tempId) || []).map((subtask) => (
                        <div key={subtask.tempId} className="ml-4 mt-2 border border-slate-800 rounded p-2 flex items-center gap-2">
                          <button className="text-left flex-1" onClick={() => setSelected({ type: 'subtask', tempId: subtask.tempId })}>SUBTASK: {subtask.title}</button>
                          <button className="text-xs text-rose-300" onClick={() => deleteItem('subtask', subtask.tempId)}>Delete</button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}

          <button className="btn-secondary" onClick={() => addItem('epic')}>+ Add Epic</button>
        </div>

        <div className="card p-3 space-y-2">
          <h2 className="font-semibold">Item Details</h2>
          {!selectedItem && <p className="text-sm text-slate-400">Select an item from the tree to edit.</p>}
          {selectedItem && (
            <>
              <input className="input" value={selectedItem.title} onChange={(e) => updateItem(selected.type, selected.tempId, 'title', e.target.value)} placeholder="Title" />
              <textarea className="input min-h-[90px]" value={selectedItem.description} onChange={(e) => updateItem(selected.type, selected.tempId, 'description', e.target.value)} placeholder="Description" />

              <div className="grid grid-cols-2 gap-2">
                <select className="input" value={selectedItem.assignee || ''} onChange={(e) => updateItem(selected.type, selected.tempId, 'assignee', e.target.value)}>
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}
                </select>
                <select className="input" value={selectedItem.priority} onChange={(e) => updateItem(selected.type, selected.tempId, 'priority', e.target.value)}>
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input type="date" className="input" value={selectedItem.startDate || ''} onChange={(e) => updateItem(selected.type, selected.tempId, 'startDate', e.target.value)} />
                <input type="date" className="input" value={selectedItem.dueDate || ''} onChange={(e) => updateItem(selected.type, selected.tempId, 'dueDate', e.target.value)} />
              </div>

              <input type="number" className="input" value={selectedItem.storyPoints ?? 0} onChange={(e) => updateItem(selected.type, selected.tempId, 'storyPoints', Number(e.target.value) || 0)} placeholder="Story Points" />

              {selected.type === 'story' && (
                <select
                  className="input"
                  value={selectedItem.epicTempId || ''}
                  onChange={(e) => {
                    updateItem('story', selected.tempId, 'epicTempId', e.target.value)
                    updateItem('story', selected.tempId, 'parentId', e.target.value)
                  }}
                >
                  {draft.epics.map((e) => <option key={e.tempId} value={e.tempId}>Parent Epic: {e.title}</option>)}
                </select>
              )}

              {selected.type === 'task' && (
                <select
                  className="input"
                  value={selectedItem.parentTempId || ''}
                  onChange={(e) => {
                    const parentStory = draft.stories.find((s) => s.tempId === e.target.value)
                    updateItem('task', selected.tempId, 'parentTempId', e.target.value)
                    updateItem('task', selected.tempId, 'parentId', e.target.value)
                    if (parentStory?.epicTempId) updateItem('task', selected.tempId, 'epicTempId', parentStory.epicTempId)
                  }}
                >
                  {draft.stories.map((s) => <option key={s.tempId} value={s.tempId}>Parent Story: {s.title}</option>)}
                </select>
              )}

              {selected.type === 'subtask' && (
                <select
                  className="input"
                  value={selectedItem.parentTempId || ''}
                  onChange={(e) => {
                    const parentTask = draft.tasks.find((t) => t.tempId === e.target.value)
                    updateItem('subtask', selected.tempId, 'parentTempId', e.target.value)
                    updateItem('subtask', selected.tempId, 'parentId', e.target.value)
                    if (parentTask?.epicTempId) updateItem('subtask', selected.tempId, 'epicTempId', parentTask.epicTempId)
                  }}
                >
                  {draft.tasks.map((t) => <option key={t.tempId} value={t.tempId}>Parent Task: {t.title}</option>)}
                </select>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
