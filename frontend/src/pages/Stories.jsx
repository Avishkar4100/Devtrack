import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  SparklesIcon, ChevronDownIcon, ChevronRightIcon,
  RocketLaunchIcon, TrashIcon, ArrowUpTrayIcon,
  ExclamationTriangleIcon, CheckCircleIcon,
} from '@heroicons/react/24/outline'
import api from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { getStatusBadgeClass, getCodeStatusLabel, getPriorityColor } from '@/lib/utils'
import toast from 'react-hot-toast'
import { motion, AnimatePresence } from 'framer-motion'

// Type badge config — inline styles to avoid Tailwind light-mode class conflicts
const TYPE_CONFIG = {
  story:   { label: 'Story',   style: { background:'rgba(59,130,246,0.14)',  color:'#93c5fd', border:'1px solid rgba(59,130,246,0.3)'  } },
  task:    { label: 'Task',    style: { background:'rgba(245,158,11,0.14)',  color:'#fcd34d', border:'1px solid rgba(245,158,11,0.3)'  } },
  subtask: { label: 'Subtask', style: { background:'rgba(139,92,246,0.14)',  color:'#c4b5fd', border:'1px solid rgba(139,92,246,0.3)'  } },
  bug:     { label: 'Bug',     style: { background:'rgba(244,63,94,0.14)',   color:'#fda4af', border:'1px solid rgba(244,63,94,0.3)'   } },
}

export default function StoriesPage() {
  const { id: projectId } = useParams()
  const { isScrumMaster } = useAuthStore()
  const qc = useQueryClient()
  const [expandedEpics, setExpandedEpics] = useState({})
  const [expandedStories, setExpandedStories] = useState({})
  const [showGenerate, setShowGenerate] = useState(false)
  const [generateForm, setGenerateForm] = useState({ moduleName: '', additionalContext: '' })
  const [generatedResult, setGeneratedResult] = useState(null)
  const [showPushJira, setShowPushJira] = useState(false)
  const [jiraProjectKey, setJiraProjectKey] = useState('')
  const [filter, setFilter] = useState('all')

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const { data } = await api.get(`/projects/${projectId}`)
      return data.data
    },
  })

  // Check for processed SRS documents
  const { data: documents = [] } = useQuery({
    queryKey: ['documents', projectId],
    queryFn: async () => {
      const { data } = await api.get(`/documents/project/${projectId}`)
      return data.data
    },
  })
  const processedDocs = documents.filter((d) => d.status === 'processed')
  const hasSRS = processedDocs.length > 0

  const { data: epics = [] } = useQuery({
    queryKey: ['epics', projectId],
    queryFn: async () => {
      const { data } = await api.get(`/stories/epics/${projectId}`)
      return data.data
    },
  })

  const { data: stories = [], isLoading } = useQuery({
    queryKey: ['stories', projectId],
    queryFn: async () => {
      const { data } = await api.get(`/stories/project/${projectId}`)
      return data.data
    },
  })

  const generateMutation = useMutation({
    mutationFn: (body) => api.post(`/stories/generate/${projectId}`, body),
    onSuccess: ({ data }) => {
      setGeneratedResult(data.data)
      toast.success('✨ AI stories generated!')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Generation failed'),
  })

  const saveMutation = useMutation({
    mutationFn: (body) => api.post(`/stories/save/${projectId}`, body),
    onSuccess: () => {
      qc.invalidateQueries(['stories', projectId])
      qc.invalidateQueries(['epics', projectId])
      setGeneratedResult(null)
      setShowGenerate(false)
      setGenerateForm({ moduleName: '', additionalContext: '' })
      toast.success('Stories saved!')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }) => api.put(`/stories/${id}`, body),
    onSuccess: () => qc.invalidateQueries(['stories', projectId]),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/stories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries(['stories', projectId])
      qc.invalidateQueries(['epics', projectId])
      toast.success('Deleted')
    },
  })

  const pushJiraMutation = useMutation({
    mutationFn: (body) => api.post(`/jira/push/${projectId}`, body),
    onSuccess: ({ data }) => {
      qc.invalidateQueries(['stories', projectId])
      qc.invalidateQueries(['epics', projectId])
      toast.success(`Pushed ${data.data.epics.length} epics and ${data.data.stories.length} stories to Jira`) 
      setShowPushJira(false)
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to push to Jira')
    },
  })

  const connectJiraMutation = useMutation({
    mutationFn: (body) => api.post(`/jira/connect/${projectId}`, body),
    onSuccess: ({ data }) => {
      qc.invalidateQueries(['project', projectId])
      toast.success(data.message || 'Jira connected successfully')
      setJiraProjectKey(data.data?.jiraProjectKey || '')
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to connect Jira project')
    },
  })

  const toggleEpic = (id) => setExpandedEpics((p) => ({ ...p, [id]: !p[id] }))
  const toggleStory = (id) => setExpandedStories((p) => ({ ...p, [id]: !p[id] }))

  const filteredStories = filter === 'all' ? stories : stories.filter((s) => s.status === filter || s.type === filter)
  const rootStories = (epicId) =>
    filteredStories.filter((s) => (s.epic?._id === epicId || s.epic === epicId) && s.type !== 'subtask')
  const subtasksOf = (storyId) =>
    stories.filter((s) => s.parentStory === storyId || s.parentStory?._id === storyId)
  const orphanStories = filteredStories.filter((s) => !s.epic && s.type !== 'subtask')

  const unpushedEpicIds = epics.filter((e) => !e.pushedToJira).map((e) => e._id)
  const unpushedStoryIds = stories.filter((s) => !s.pushedToJira && s.status === 'approved').map((s) => s._id)
  const jiraConnected = Boolean(project?.jiraConnected && project?.jiraProjectKey)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div className="flex items-center justify-between mb-4 flex-wrap gap-3"
        initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#f3f4f6' }}>Stories &amp; Epics</h1>
          <p className="text-sm" style={{ color: '#64748b' }}>
            {stories.filter((s) => s.type === 'story').length} stories ·{' '}
            {stories.filter((s) => s.type === 'task').length} tasks ·{' '}
            {stories.filter((s) => s.type === 'subtask').length} subtasks across {epics.length} epics
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isScrumMaster() && (
            <>
              <motion.button onClick={() => setShowPushJira(true)} className="btn-secondary btn-sm"
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                <ArrowUpTrayIcon className="w-4 h-4" /> {jiraConnected ? 'Push to Jira' : 'Connect Jira'}
              </motion.button>
              <motion.button onClick={() => setShowGenerate(true)} className="btn-primary btn-sm"
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                <SparklesIcon className="w-4 h-4" /> AI Generate
              </motion.button>
            </>
          )}
        </div>
      </motion.div>

      {/* SRS status banner */}
      {!hasSRS && (
        <div className="mb-4 p-3.5 rounded-xl flex items-start gap-3"
             style={{ background:'rgba(245,158,11,0.08)', border:'1px solid rgba(180,83,9,0.2)' }}>
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">No processed SRS document</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Upload and process an SRS/MD document in the <strong>Documents</strong> tab before generating stories.
            </p>
          </div>
        </div>
      )}
      {hasSRS && (
        <div className="mb-4 p-3 rounded-xl flex items-center gap-2"
             style={{ background:'rgba(16,185,129,0.07)', border:'1px solid rgba(5,150,105,0.2)' }}>
          <CheckCircleIcon className="w-4 h-4 text-emerald-600 shrink-0" />
          <p className="text-xs text-emerald-700 font-medium">
            {processedDocs.length} processed SRS document{processedDocs.length > 1 ? 's' : ''} ready — AI will use this context to generate stories.
          </p>
        </div>
      )}

      {/* Type legend */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {Object.entries(TYPE_CONFIG).slice(0, 3).map(([key, cfg]) => (
          <span key={key} className="text-[11px] font-medium px-2 py-1 rounded" style={cfg.style}>
            {cfg.label}
          </span>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {['all', 'story', 'task', 'subtask', 'in_progress', 'done'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`btn-sm rounded-full whitespace-nowrap ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
          >
            {f === 'all' ? 'All' : f.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            <span className="ml-1 text-xs opacity-70">
              ({f === 'all' ? stories.length : stories.filter((s) => s.type === f || s.status === f).length})
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <motion.div key={i} className="card h-16"
              initial={{ opacity: 0 }} animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.15 }} />
          ))}
        </div>
      ) : (
        <motion.div className="space-y-3"
          initial="hidden" animate="show"
          variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
          {epics.map((epic) => {
            const epicStories = rootStories(epic._id)
            const isOpen = expandedEpics[epic._id] !== false
            return (
              <motion.div key={epic._id} className="card overflow-hidden"
                variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16,1,0.3,1] } } }}>
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer"
                  style={{ borderRadius: 0, transition: 'background 0.18s' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(99,102,241,0.07)'}
                  onMouseLeave={e => e.currentTarget.style.background=''}
                  onClick={() => toggleEpic(epic._id)}
                >
                  <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.22, ease: 'easeInOut' }}>
                    <ChevronRightIcon className="w-4 h-4" style={{ color: '#64748b' }} />
                  </motion.div>
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: epic.color || '#6366f1' }} />
                  <span className="font-bold flex-1 text-sm" style={{ color: '#e2e8f0' }}>{epic.title}</span>
                  <div className="flex items-center gap-3 ml-auto">
                    <span className="text-xs" style={{ color: '#64748b' }}>{epic.completedStories}/{epic.totalStories}</span>
                    <div className="w-24 progress-bar">
                      <motion.div className="progress-fill"
                        initial={{ width: '0%' }}
                        animate={{ width: `${epic.completionPercentage}%` }}
                        transition={{ duration: 1, ease: [0.16,1,0.3,1], delay: 0.3 }}
                        style={{ background:'linear-gradient(90deg,#6366f1,#8b5cf6)' }} />
                    </div>
                    <span className="text-xs font-semibold" style={{ color: '#94a3b8' }}>{epic.completionPercentage}%</span>
                    <span className={`badge ${getStatusBadgeClass(epic.status)}`}>{epic.status}</span>
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      style={{ overflow: 'hidden', borderTop:'1px solid rgba(255,255,255,0.06)' }}>
                      {epicStories.length > 0 ? epicStories.map((story, idx) => (
                        <StoryRow
                          key={story._id}
                          story={story}
                          subtasks={subtasksOf(story._id)}
                          expanded={!!expandedStories[story._id]}
                          onToggle={() => toggleStory(story._id)}
                          onStatusChange={(status) => updateMutation.mutate({ id: story._id, status })}
                          onDelete={() => deleteMutation.mutate(story._id)}
                          delay={idx * 0.04}
                        />
                      )) : (
                        <div className="px-6 py-3 text-sm" style={{ color:'#475569' }}>No stories in this epic yet.</div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}

          {orphanStories.length > 0 && (
            <motion.div className="card overflow-hidden"
              variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16,1,0.3,1] } } }}>
              <div className="p-4" style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                <span className="font-bold text-sm" style={{ color:'#64748b' }}>Other Stories</span>
              </div>
              {orphanStories.map((story, idx) => (
                <StoryRow key={story._id} story={story} subtasks={subtasksOf(story._id)}
                  expanded={!!expandedStories[story._id]} onToggle={() => toggleStory(story._id)}
                  onStatusChange={(status) => updateMutation.mutate({ id: story._id, status })}
                  onDelete={() => deleteMutation.mutate(story._id)} delay={idx * 0.04} />
              ))}
            </motion.div>
          )}

          {stories.length === 0 && (
            <motion.div className="card p-16 text-center"
              initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: [0.16,1,0.3,1] }}>
              <motion.div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                style={{ background:'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(109,40,217,0.08))' }}
                animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
                <RocketLaunchIcon className="w-8 h-8" style={{ color: '#818cf8' }} />
              </motion.div>
              <p className="font-semibold mb-1" style={{ color: '#e2e8f0' }}>No stories yet</p>
              <p className="text-sm mb-6" style={{ color: '#475569' }}>
                {hasSRS ? 'Click "AI Generate" to create stories from your SRS document.' : 'Upload an SRS document first, then use AI to generate stories.'}
              </p>
              {isScrumMaster() && hasSRS && (
                <motion.button onClick={() => setShowGenerate(true)} className="btn-primary"
                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                  <SparklesIcon className="w-4 h-4" /> Generate with AI
                </motion.button>
              )}
            </motion.div>
          )}
        </motion.div>
      )}

      {/* AI Generate Modal */}
      <AnimatePresence>
        {showGenerate && (
          <Modal title="🧠 AI Story Generator" onClose={() => { setShowGenerate(false); setGeneratedResult(null) }} wide>
          {!generatedResult ? (
            <form onSubmit={(e) => { e.preventDefault(); generateMutation.mutate(generateForm) }} className="space-y-4">
              {!hasSRS && (
                <div className="p-3 rounded-xl flex items-start gap-2"
                     style={{ background:'rgba(239,68,68,0.07)', border:'1px solid rgba(185,28,28,0.2)' }}>
                  <ExclamationTriangleIcon className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">
                    No processed SRS document found. Go to the <strong>Documents</strong> tab, upload an SRS/MD file, and wait for processing.
                  </p>
                </div>
              )}
              {hasSRS && (
                <div className="p-3 rounded-xl text-xs text-emerald-700 font-medium"
                     style={{ background:'rgba(16,185,129,0.07)', border:'1px solid rgba(5,150,105,0.2)' }}>
                  ✓ Using context from: {processedDocs.map((d) => d.name || d.originalName).join(', ')}
                </div>
              )}
              <p className="text-sm text-gray-600">
                AI will generate <strong className="text-gray-900">Epics → Stories → Tasks → Subtasks</strong> from your SRS context.
              </p>
              <div>
                <label className="input-label">Module Name *</label>
                <input
                  type="text"
                  value={generateForm.moduleName}
                  onChange={(e) => setGenerateForm({ ...generateForm, moduleName: e.target.value })}
                  className="input"
                  placeholder="e.g. Appointment Booking, User Authentication, Payment Gateway..."
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="input-label">Additional Context (optional)</label>
                <textarea
                  value={generateForm.additionalContext}
                  onChange={(e) => setGenerateForm({ ...generateForm, additionalContext: e.target.value })}
                  className="input resize-none"
                  rows={3}
                  placeholder="Tech stack, constraints, team size..."
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowGenerate(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={generateMutation.isPending || !hasSRS} className="btn-primary flex-1">
                  {generateMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/>
                      </svg>
                      Generating...
                    </span>
                  ) : '✨ Generate Stories'}
                </button>
              </div>
            </form>
          ) : (
            <GeneratedPreview
              result={generatedResult}
              onRegenerate={() => setGeneratedResult(null)}
              onSave={() => saveMutation.mutate(generatedResult)}
              saving={saveMutation.isPending}
            />
          )}
          </Modal>
        )}
      </AnimatePresence>

      {/* Push to Jira modal */}
      <AnimatePresence>
        {showPushJira && (
          <Modal title="Push to Jira" onClose={() => setShowPushJira(false)}>
          {!jiraConnected ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                This project is not connected to Jira yet. Enter your Jira project key to connect first.
              </p>
              <div>
                <label className="input-label">Jira Project Key</label>
                <input
                  type="text"
                  value={jiraProjectKey}
                  onChange={(e) => setJiraProjectKey(e.target.value.toUpperCase())}
                  className="input"
                  placeholder="Example: DEV"
                />
                <p className="text-xs text-gray-500 mt-1">Save Jira credentials in Settings first, then connect the project key here.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowPushJira(false)} className="btn-secondary flex-1">Cancel</button>
                <button
                  onClick={() => connectJiraMutation.mutate({ jiraProjectKey })}
                  disabled={connectJiraMutation.isPending || !jiraProjectKey.trim()}
                  className="btn-primary flex-1"
                >
                  {connectJiraMutation.isPending ? 'Connecting...' : 'Connect Jira'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-2">
                Connected project key: <strong>{project?.jiraProjectKey}</strong>
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Push {unpushedEpicIds.length} unpushed epics and {unpushedStoryIds.length} approved stories to Jira.
              </p>
              {unpushedEpicIds.length === 0 && unpushedStoryIds.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">All stories are already pushed to Jira.</p>
              ) : (
                <div className="flex gap-3">
                  <button onClick={() => setShowPushJira(false)} className="btn-secondary flex-1">Cancel</button>
                  <button
                    onClick={() => pushJiraMutation.mutate({ epicIds: unpushedEpicIds, storyIds: unpushedStoryIds })}
                    disabled={pushJiraMutation.isPending}
                    className="btn-primary flex-1"
                  >
                    {pushJiraMutation.isPending ? 'Pushing...' : 'Push to Jira'}
                  </button>
                </div>
              )}
            </>
          )}
          </Modal>
        )}
      </AnimatePresence>
    </div>
  )
}

// Story/Task/Subtask row with expandable AC and subtask list
const StoryRow = ({ story, subtasks = [], expanded, onToggle, onStatusChange, onDelete, indent = false, delay = 0 }) => {
  const cfg = TYPE_CONFIG[story.type] || TYPE_CONFIG.story
  const hasAC = story.acceptanceCriteria?.length > 0
  const hasSubtasks = subtasks.length > 0
  const canExpand = hasAC || hasSubtasks

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1], delay }}
    >
      <div className={`flex items-start gap-3 px-4 py-3 group ${indent ? 'pl-12' : ''}`}
           style={{ borderBottom:'1px solid rgba(255,255,255,0.05)', background: indent ? 'rgba(255,255,255,0.02)' : 'transparent', transition: 'background 0.15s' }}
           onMouseEnter={e => e.currentTarget.style.background='rgba(99,102,241,0.06)'}
           onMouseLeave={e => e.currentTarget.style.background= indent ? 'rgba(255,255,255,0.02)' : 'transparent'}>
        {/* Expand toggle */}
        <motion.button
          onClick={canExpand ? onToggle : undefined}
          className={`mt-0.5 shrink-0 ${canExpand ? 'cursor-pointer' : 'cursor-default'}`}
          style={{ color: canExpand ? '#64748b' : 'transparent' }}
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.2 }}>
          {canExpand ? <ChevronRightIcon className="w-3.5 h-3.5" /> : <div className="w-3.5 h-3.5" />}
        </motion.button>

        {/* Status dot */}
        <div className="w-4 h-4 rounded shrink-0 mt-0.5 flex items-center justify-center" style={{ border:'2px solid rgba(255,255,255,0.15)' }}>
          {story.status === 'done' && <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />}
          {story.status === 'in_progress' && <div className="w-2.5 h-2.5 rounded-sm bg-blue-500" />}
          {story.status === 'in_review' && <div className="w-2.5 h-2.5 rounded-sm bg-amber-500" />}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={cfg.style}>
              {cfg.label}
            </span>
            {story.storyKey && <span className="text-[10px] text-gray-500 font-mono">{story.storyKey}</span>}
            {story.pushedToJira && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-800">Jira</span>
            )}
          </div>
          <p className={`text-sm font-medium ${story.status === 'done' ? 'line-through' : ''}`}
            style={{ color: story.status === 'done' ? '#475569' : '#e2e8f0' }}>
            {story.title}
          </p>

          {/* Acceptance Criteria (expanded) */}
          <AnimatePresence>
          {expanded && hasAC && (
            <motion.div className="mt-2 pl-1 space-y-0.5" style={{ borderLeft:'2px solid rgba(99,102,241,0.3)' }}
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}>
              <p className="text-[10px] font-semibold uppercase mb-1" style={{ color: '#64748b' }}>Acceptance Criteria</p>
              {story.acceptanceCriteria.map((ac, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className={`text-[10px] mt-0.5 ${ac.met ? 'text-emerald-500' : 'text-gray-400'}`}>
                    {ac.met ? '✓' : '○'}
                  </span>
                  <p className={`text-xs ${ac.met ? 'line-through' : ''}`} style={{ color: ac.met ? '#10b981' : '#64748b' }}>
                    {ac.criterion}
                  </p>
                </div>
              ))}
            </motion.div>
          )}
          </AnimatePresence>

          {/* Subtasks (expanded) */}
          <AnimatePresence>
          {expanded && hasSubtasks && (
            <motion.div className="mt-2 space-y-0"
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}>
              <p className="text-[10px] font-semibold uppercase mb-1" style={{ color: '#64748b' }}>Subtasks ({subtasks.length})</p>
              {subtasks.map((sub) => (
                <div key={sub._id} className="flex items-center gap-2 py-1" style={{ borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
                  <div className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={TYPE_CONFIG.subtask.style}>Sub</div>
                  <p className="text-xs flex-1" style={{ color:'#cbd5e1' }}>{sub.title}</p>
                  <span className="text-[10px]" style={{ color:'#475569' }}>{sub.storyPoints}p</span>
                  <span className={`badge ${getStatusBadgeClass(sub.status)} text-[10px]`}>{sub.status?.replace('_', ' ')}</span>
                </div>
              ))}
            </motion.div>
          )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {story.storyPoints > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background:'rgba(255,255,255,0.07)', color:'#94a3b8' }}>{story.storyPoints}p</span>
          )}
          <span className={`text-xs font-medium ${getPriorityColor(story.priority)}`}>
            {story.priority?.slice(0, 3).toUpperCase()}
          </span>
          <span className="text-xs text-gray-500">{story.sprint}</span>
          <span className={`badge ${getStatusBadgeClass(story.status)} text-xs`}>{story.status?.replace('_', ' ')}</span>

          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            <select value={story.status} onChange={(e) => onStatusChange(e.target.value)}
              className="text-xs rounded-lg px-2 py-1" style={{ background:'#0d0d1e', border:'1px solid rgba(99,102,241,0.3)', color:'#e2e8f0' }}>
              {['draft', 'approved', 'to_do', 'in_progress', 'in_review', 'done', 'cancelled'].map((s) => (
                <option key={s} value={s} style={{ background:'#0d0d1e', color:'#e2e8f0' }}>{s.replace('_', ' ')}</option>
              ))}
            </select>
            <motion.button onClick={onDelete} className="btn-ghost btn-sm p-1" style={{ color: '#f43f5e' }}
              whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.9 }}>
              <TrashIcon className="w-3.5 h-3.5" />
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// Preview of AI-generated results before saving
const GeneratedPreview = ({ result, onRegenerate, onSave, saving }) => {
  const totalItems = (result.epics?.length || 0) + (result.stories?.length || 0) + (result.tasks?.length || 0) + (result.subtasks?.length || 0)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          { label: 'Epics',    count: result.epics?.length    || 0, color: '#818cf8' },
          { label: 'Stories',  count: result.stories?.length  || 0, color: '#93c5fd' },
          { label: 'Tasks',    count: result.tasks?.length    || 0, color: '#fcd34d' },
          { label: 'Subtasks', count: result.subtasks?.length || 0, color: '#c4b5fd' },
        ].map(({ label, count, color }) => (
          <div key={label} className="rounded-lg p-2" style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xl font-bold" style={{ color }}>{count}</p>
            <p className="text-[11px]" style={{ color:'#64748b' }}>{label}</p>
          </div>
        ))}
      </div>

      <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
        {/* Epics */}
        {result.epics?.map((epic, i) => (
          <div key={i} className="rounded-lg p-3" style={{ background:'rgba(99,102,241,0.1)', border:'1px solid rgba(99,102,241,0.25)' }}>
            <p className="text-[10px] font-semibold uppercase mb-1" style={{ color:'#818cf8' }}>EPIC · {epic.sprint}</p>
            <p className="font-semibold text-sm" style={{ color:'#f1f5f9' }}>{epic.title}</p>
            <p className="text-xs mt-1" style={{ color:'#94a3b8' }}>{epic.description}</p>
          </div>
        ))}

        {/* Stories */}
        {result.stories?.map((s, i) => (
          <PreviewItem key={i} item={s} cfg={TYPE_CONFIG.story} />
        ))}

        {/* Tasks */}
        {result.tasks?.map((s, i) => (
          <PreviewItem key={i} item={s} cfg={TYPE_CONFIG.task} />
        ))}

        {/* Subtasks */}
        {result.subtasks?.length > 0 && (
            <div className="rounded-lg overflow-hidden" style={{ border:'1px solid rgba(139,92,246,0.25)' }}>
              <div className="px-3 py-2" style={{ background:'rgba(139,92,246,0.12)' }}>
              <p className="text-[10px] font-semibold uppercase" style={{ color:'#c4b5fd' }}>Subtasks ({result.subtasks.length})</p>
            </div>
            {result.subtasks.map((s, i) => (
              <div key={i} className="px-3 py-2 flex items-start gap-2" style={{ borderTop:'1px solid rgba(139,92,246,0.12)' }}>
                <span className="text-[10px] mt-0.5 shrink-0" style={{ color:'#a78bfa' }}>↳</span>
                <div className="flex-1">
                  <p className="text-xs" style={{ color:'#e2e8f0' }}>{s.title}</p>
                  {s.acceptanceCriteria?.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {s.acceptanceCriteria.map((ac, j) => (
                        <li key={j} className="text-[10px] text-gray-500">✓ {ac}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <span className="text-[10px] text-gray-500 shrink-0">{s.storyPoints}p</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-1">
        <button onClick={onRegenerate} className="btn-secondary flex-1">← Regenerate</button>
        <button onClick={onSave} disabled={saving} className="btn-primary flex-1">
          {saving ? 'Saving...' : `✅ Approve & Save (${totalItems} items)`}
        </button>
      </div>
    </div>
  )
}

const PreviewItem = ({ item, cfg }) => {
  const [open, setOpen] = useState(false)
  const baseStyle = { ...cfg.style, borderRadius: '8px' }
  return (
    <div style={baseStyle}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full text-left p-3 flex items-start gap-2"
      >
        <span className="mt-0.5 shrink-0" style={{ color:'#64748b' }}>
          {open ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-semibold" style={{ color: cfg.style.color }}>{cfg.label.toUpperCase()}</span>
            <span className="text-[10px]" style={{ color:'#64748b' }}>{item.sprint} · {item.storyPoints}p · {item.priority}</span>
          </div>
          <p className="text-sm" style={{ color:'#e2e8f0' }}>{item.title}</p>
        </div>
      </button>
      {open && item.acceptanceCriteria?.length > 0 && (
        <div className="px-8 pb-3 pt-2" style={{ borderTop:'1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-[10px] font-semibold uppercase mb-1.5" style={{ color:'#64748b' }}>Acceptance Criteria</p>
          <ul className="space-y-1">
            {item.acceptanceCriteria.map((ac, j) => (
              <li key={j} className="flex items-start gap-1.5">
                <span className="text-[11px] mt-0.5" style={{ color:'#34d399' }}>✓</span>
                <span className="text-xs" style={{ color:'#94a3b8' }}>{ac}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const Modal = ({ title, children, onClose, wide }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <motion.div className="absolute inset-0"
      style={{ background:'rgba(6,6,15,0.7)', backdropFilter:'blur(8px)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose} />
    <motion.div className={`relative ${wide ? 'w-full max-w-2xl' : 'w-full max-w-md'} card p-6 max-h-[90vh] overflow-y-auto`}
      style={{ boxShadow:'0 24px 64px rgba(0,0,0,0.4)' }}
      initial={{ opacity: 0, scale: 0.94, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: 10 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-bold" style={{ color: '#f3f4f6' }}>{title}</h3>
        <motion.button onClick={onClose} className="btn-ghost btn-sm p-1.5" style={{ color: '#64748b' }}
          whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>✕</motion.button>
      </div>
      {children}
    </motion.div>
  </div>
)
