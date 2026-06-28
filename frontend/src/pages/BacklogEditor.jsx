import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { useWorkspaceStateStore } from '@/store/workspaceStateStore'
import ConfirmDialog from '@/components/ConfirmDialog'

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
    const normalized = fromRoute 
      ? normalizeBacklog(fromRoute)
      : workspaceState?.generatedBacklogDraft 
        ? normalizeBacklog(workspaceState.generatedBacklogDraft)
        : { epics: [], stories: [], tasks: [], subtasks: [] }
    
    // Ensure all required properties exist
    return {
      epics: normalized.epics || [],
      stories: normalized.stories || [],
      tasks: normalized.tasks || [],
      subtasks: normalized.subtasks || [],
    }
  }, [location.state, workspaceState])

  const [draft, setDraft] = useState(initialDraft)
  const [selected, setSelected] = useState({ type: 'epic', tempId: initialDraft.epics[0]?.tempId || '' })
  const [selectedForDelete, setSelectedForDelete] = useState(new Set())
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, itemCount: 0 })

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
    setDraft((prev) => {
      const arrayKey = `${type}s`
      const currentArray = prev[arrayKey] || []
      return {
        ...prev,
        [arrayKey]: currentArray.map((item) => item.tempId === tempId ? { ...item, [field]: value } : item),
      }
    })
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

    setDraft((prev) => {
      const arrayKey = `${type}s`
      const currentArray = prev[arrayKey] || []
      return {
        ...prev,
        [arrayKey]: [...currentArray, item],
      }
    })
    setSelected({ type, tempId: item.tempId })
  }

  const deleteItem = (type, tempId) => {
    setDraft((prev) => {
      // Ensure all arrays exist
      const next = {
        epics: prev.epics || [],
        stories: prev.stories || [],
        tasks: prev.tasks || [],
        subtasks: prev.subtasks || [],
      }
      
      if (type === 'epic') {
        const storyIds = next.stories.filter((s) => s.epicTempId === tempId).map((s) => s.tempId)
        const taskIds = next.tasks.filter((t) => t.epicTempId === tempId || storyIds.includes(t.parentTempId)).map((t) => t.tempId)
        next.epics = next.epics.filter((e) => e.tempId !== tempId)
        next.stories = next.stories.filter((s) => s.epicTempId !== tempId)
        next.tasks = next.tasks.filter((t) => !taskIds.includes(t.tempId))
        next.subtasks = next.subtasks.filter((st) => !taskIds.includes(st.parentTempId))
      } else if (type === 'story') {
        const taskIds = next.tasks.filter((t) => t.parentTempId === tempId).map((t) => t.tempId)
        next.stories = next.stories.filter((s) => s.tempId !== tempId)
        next.tasks = next.tasks.filter((t) => t.parentTempId !== tempId)
        next.subtasks = next.subtasks.filter((st) => !taskIds.includes(st.parentTempId))
      } else if (type === 'task') {
        next.tasks = next.tasks.filter((t) => t.tempId !== tempId)
        next.subtasks = next.subtasks.filter((st) => st.parentTempId !== tempId)
      } else if (type === 'subtask') {
        next.subtasks = next.subtasks.filter((st) => st.tempId !== tempId)
      }
      return next
    })
    setSelected({ type: 'epic', tempId: draft.epics[0]?.tempId || '' })
  }

  const toggleSelectForDelete = (type, tempId) => {
    const key = `${type}:${tempId}`
    const newSet = new Set(selectedForDelete)
    if (newSet.has(key)) {
      newSet.delete(key)
    } else {
      newSet.add(key)
    }
    setSelectedForDelete(newSet)
  }

  const bulkDelete = () => {
    if (selectedForDelete.size === 0) return

    setDraft((prev) => {
      // Ensure all arrays exist
      let next = {
        epics: prev.epics || [],
        stories: prev.stories || [],
        tasks: prev.tasks || [],
        subtasks: prev.subtasks || [],
      }

      // Collect all items to delete
      const toDelete = Array.from(selectedForDelete).map((key) => {
        const [type, tempId] = key.split(':')
        return { type, tempId }
      })

      // Sort by type order (process epics first, then stories, then tasks, then subtasks)
      const typeOrder = { epic: 0, story: 1, task: 2, subtask: 3 }
      toDelete.sort((a, b) => typeOrder[a.type] - typeOrder[b.type])

      // Delete each item (will cascade as needed)
      toDelete.forEach(({ type, tempId }) => {
        if (type === 'epic') {
          const storyIds = next.stories.filter((s) => s.epicTempId === tempId).map((s) => s.tempId)
          const taskIds = next.tasks.filter((t) => t.epicTempId === tempId || storyIds.includes(t.parentTempId)).map((t) => t.tempId)
          next.epics = next.epics.filter((e) => e.tempId !== tempId)
          next.stories = next.stories.filter((s) => s.epicTempId !== tempId)
          next.tasks = next.tasks.filter((t) => !taskIds.includes(t.tempId))
          next.subtasks = next.subtasks.filter((st) => !taskIds.includes(st.parentTempId))
        } else if (type === 'story') {
          const taskIds = next.tasks.filter((t) => t.parentTempId === tempId).map((t) => t.tempId)
          next.stories = next.stories.filter((s) => s.tempId !== tempId)
          next.tasks = next.tasks.filter((t) => t.parentTempId !== tempId)
          next.subtasks = next.subtasks.filter((st) => !taskIds.includes(st.parentTempId))
        } else if (type === 'task') {
          next.tasks = next.tasks.filter((t) => t.tempId !== tempId)
          next.subtasks = next.subtasks.filter((st) => st.parentTempId !== tempId)
        } else if (type === 'subtask') {
          next.subtasks = next.subtasks.filter((st) => st.tempId !== tempId)
        }
      })

      return next
    })

    setSelectedForDelete(new Set())
    setConfirmDialog({ isOpen: false, itemCount: 0 })
    toast.success(`Deleted ${selectedForDelete.size} item(s)`)
  }

  const fixOrphans = () => {
    setDraft((prev) => {
      // Ensure all arrays exist
      const epics = prev.epics || []
      const stories = prev.stories || []
      const tasks = prev.tasks || []
      const subtasks = prev.subtasks || []
      
      const epicIds = new Set(epics.map((e) => e.tempId))
      const storyIds = new Set(stories.map((s) => s.tempId))
      const taskIds = new Set(tasks.map((t) => t.tempId))
      const firstTaskId = tasks[0]?.tempId || null
      const firstStoryId = stories[0]?.tempId || null
      const firstEpicId = epics[0]?.tempId || null

      let fixed = false

      // Fix orphan stories
      const fixedStories = stories.map((s) => {
        if (!s.epicTempId || !epicIds.has(s.epicTempId)) {
          fixed = true
          return { ...s, epicTempId: firstEpicId, parentId: firstEpicId }
        }
        return s
      })

      // Fix orphan tasks
      const fixedTasks = tasks.map((t) => {
        if (!t.parentTempId || !storyIds.has(t.parentTempId)) {
          fixed = true
          const newParentId = firstStoryId
          const parentStory = fixedStories.find((s) => s.tempId === newParentId)
          return { ...t, parentTempId: newParentId, parentId: newParentId, epicTempId: parentStory?.epicTempId || firstEpicId }
        }
        return t
      })

      // Fix orphan subtasks
      const fixedSubtasks = subtasks.map((st) => {
        if (!st.parentTempId || !taskIds.has(st.parentTempId)) {
          fixed = true
          const newParentId = firstTaskId
          const parentTask = fixedTasks.find((t) => t.tempId === newParentId)
          return { ...st, parentTempId: newParentId, parentId: newParentId, epicTempId: parentTask?.epicTempId || firstEpicId }
        }
        return st
      })

      if (fixed) toast.success('Fixed orphaned items')
      return { epics, stories: fixedStories, tasks: fixedTasks, subtasks: fixedSubtasks }
    })
  }

  const validateDraft = () => {
    const epics = draft.epics || []
    const stories = draft.stories || []
    const tasks = draft.tasks || []
    const subtasks = draft.subtasks || []
    
    if (epics.length < 3) return 'Backlog must have 3 epics (will be auto-generated if missing).'

    const hasEmpty = [...epics, ...stories, ...tasks, ...subtasks]
      .some((item) => !String(item.title || '').trim())
    if (hasEmpty) return 'All backlog items must have a title.'

    const epicIds = new Set(epics.map((e) => e.tempId))
    const storyIds = new Set(stories.map((s) => s.tempId))
    const taskIds = new Set(tasks.map((t) => t.tempId))

    if (stories.some((s) => !s.epicTempId || !epicIds.has(s.epicTempId))) return 'All stories must be linked to an epic.'
    if (tasks.some((t) => !t.parentTempId || !storyIds.has(t.parentTempId))) return 'All tasks must be linked to a story.'
    if (subtasks.some((st) => !st.parentTempId || !taskIds.has(st.parentTempId))) return 'All subtasks must be linked to a task.'

    // Not all epics need stories (they might be placeholders), so we skip this check
    // const epicWithoutStories = epics.some((e) => !stories.some((s) => s.epicTempId === e.tempId))

    const storyWithoutTasks = stories.some((s) => !tasks.some((t) => t.parentTempId === s.tempId))
    if (storyWithoutTasks) return 'Each story must contain at least one task.'

    return ''
  }

  const saveAndPush = useMutation({
    mutationFn: async () => {
      const validationError = validateDraft()
      if (validationError) throw new Error(validationError)

      const epics = draft.epics || []
      const stories = draft.stories || []
      const tasks = draft.tasks || []
      const subtasks = draft.subtasks || []

      await api.post(`/stories/save/${id}`, {
        epics,
        stories,
        tasks,
        subtasks,
      })

      const freshEpics = (await api.get(`/stories/epics/${id}`)).data.data || []
      const freshStories = (await api.get(`/stories/project/${id}`)).data.data || []

      await api.post(`/jira/push/${id}`, {
        epicIds: freshEpics.map((e) => e._id),
        storyIds: freshStories.map((s) => s._id),
      })
    },
    onSuccess: () => {
      toast.success('Backlog saved and pushed to Jira')
      navigate(`/projects/${id}`)
    },
    onError: (error) => toast.error(error?.message || 'Failed to save backlog'),
  })

  if (!(draft.epics || []).length) {
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
        <div className="flex gap-2">
          {selectedForDelete.size > 0 && (
            <button
              className="btn-danger text-sm"
              onClick={() => setConfirmDialog({ isOpen: true, itemCount: selectedForDelete.size })}
            >
              🗑️ Delete {selectedForDelete.size} ({selectedForDelete.size === 1 ? 'item' : 'items'})
            </button>
          )}
          <button className="btn-secondary text-sm" onClick={fixOrphans}>
            🔧 Fix Orphans
          </button>
          <button className="btn-primary" onClick={() => saveAndPush.mutate()} disabled={saveAndPush.isPending}>
            {saveAndPush.isPending ? 'Saving...' : 'Save and Push to Jira'}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-3">
        <div className="card p-3 max-h-[76vh] overflow-auto space-y-2">
          {(draft.epics || []).map((epic) => (
            <div key={epic.tempId} className="border border-slate-700 rounded-md p-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedForDelete.has(`epic:${epic.tempId}`)}
                  onChange={() => toggleSelectForDelete('epic', epic.tempId)}
                  className="w-4 h-4 cursor-pointer"
                />
                <button className="text-left flex-1" onClick={() => setSelected({ type: 'epic', tempId: epic.tempId })}>EPIC: {epic.title}</button>
                <button className="text-xs btn-secondary" onClick={() => addItem('story', epic.tempId)}>+ Story</button>
                <button className="text-xs text-rose-300" onClick={() => deleteItem('epic', epic.tempId)}>Delete</button>
              </div>

              {(storiesByEpic.get(epic.tempId) || []).map((story) => (
                <div key={story.tempId} className="ml-4 mt-2 border border-slate-800 rounded p-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedForDelete.has(`story:${story.tempId}`)}
                      onChange={() => toggleSelectForDelete('story', story.tempId)}
                      className="w-4 h-4 cursor-pointer"
                    />
                    <button className="text-left flex-1" onClick={() => setSelected({ type: 'story', tempId: story.tempId })}>STORY: {story.title}</button>
                    <button className="text-xs btn-secondary" onClick={() => addItem('task', story.tempId)}>+ Task</button>
                    <button className="text-xs text-rose-300" onClick={() => deleteItem('story', story.tempId)}>Delete</button>
                  </div>

                  {(tasksByStory.get(story.tempId) || []).map((task) => (
                    <div key={task.tempId} className="ml-4 mt-2 border border-slate-800 rounded p-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedForDelete.has(`task:${task.tempId}`)}
                          onChange={() => toggleSelectForDelete('task', task.tempId)}
                          className="w-4 h-4 cursor-pointer"
                        />
                        <button className="text-left flex-1" onClick={() => setSelected({ type: 'task', tempId: task.tempId })}>TASK: {task.title}</button>
                        <button className="text-xs btn-secondary" onClick={() => addItem('subtask', task.tempId)}>+ Subtask</button>
                        <button className="text-xs text-rose-300" onClick={() => deleteItem('task', task.tempId)}>Delete</button>
                      </div>

                      {(subtasksByTask.get(task.tempId) || []).map((subtask) => (
                        <div key={subtask.tempId} className="ml-4 mt-2 border border-slate-800 rounded p-2 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedForDelete.has(`subtask:${subtask.tempId}`)}
                            onChange={() => toggleSelectForDelete('subtask', subtask.tempId)}
                            className="w-4 h-4 cursor-pointer"
                          />
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
                  {(draft.epics || []).map((e) => <option key={e.tempId} value={e.tempId}>Parent Epic: {e.title}</option>)}
                </select>
              )}

              {selected.type === 'task' && (
                <select
                  className="input"
                  value={selectedItem.parentTempId || ''}
                  onChange={(e) => {
                    const parentStory = (draft.stories || []).find((s) => s.tempId === e.target.value)
                    updateItem('task', selected.tempId, 'parentTempId', e.target.value)
                    updateItem('task', selected.tempId, 'parentId', e.target.value)
                    if (parentStory?.epicTempId) updateItem('task', selected.tempId, 'epicTempId', parentStory.epicTempId)
                  }}
                >
                  {(draft.stories || []).map((s) => <option key={s.tempId} value={s.tempId}>Parent Story: {s.title}</option>)}
                </select>
              )}

              {selected.type === 'subtask' && (
                <select
                  className="input"
                  value={selectedItem.parentTempId || ''}
                  onChange={(e) => {
                    const parentTask = (draft.tasks || []).find((t) => t.tempId === e.target.value)
                    updateItem('subtask', selected.tempId, 'parentTempId', e.target.value)
                    updateItem('subtask', selected.tempId, 'parentId', e.target.value)
                    if (parentTask?.epicTempId) updateItem('subtask', selected.tempId, 'epicTempId', parentTask.epicTempId)
                  }}
                  >
                  {(draft.tasks || []).map((t) => <option key={t.tempId} value={t.tempId}>Parent Task: {t.title}</option>)}
                </select>
              )}

              {Array.isArray(selectedItem.acceptanceCriteria) && selectedItem.acceptanceCriteria.length > 0 && (
                <div className="rounded-md border border-slate-700 p-3 bg-slate-900/40">
                  <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Acceptance Criteria</p>
                  <ul className="space-y-1 text-sm text-slate-200">
                    {selectedItem.acceptanceCriteria.map((ac, idx) => (
                      <li key={`${selectedItem.tempId}-ac-${idx}`}>- {typeof ac === 'string' ? ac : ac?.criterion}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(selectedItem.epicTempId || selectedItem.parentTempId) && (
                <div className="rounded-md border border-slate-700 p-3 bg-slate-900/40">
                  <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Hierarchy</p>
                  <p className="text-sm text-slate-200">Epic: {selectedItem.epicTempId || 'none'}</p>
                  <p className="text-sm text-slate-200">Parent: {selectedItem.parentTempId || 'none'}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title="Delete Items"
        message="Are you sure you want to delete the selected items? This action cannot be undone in unsaved draft."
        confirmText="Delete"
        cancelText="Keep"
        isDangerous={true}
        itemCount={confirmDialog.itemCount}
        onConfirm={bulkDelete}
        onCancel={() => setConfirmDialog({ isOpen: false, itemCount: 0 })}
      />
    </div>
  )
}
