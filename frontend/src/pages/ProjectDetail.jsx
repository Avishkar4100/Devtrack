import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
  RocketLaunchIcon, DocumentTextIcon, CodeBracketIcon, ChartBarIcon,
  UserGroupIcon, LinkIcon, CalendarIcon, CurrencyDollarIcon,
  CheckCircleIcon, ClockIcon, ExclamationCircleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import api from '@/lib/api'
import { useProjectStore } from '@/store/projectStore'
import { getProgressColor, formatDate } from '@/lib/utils'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

const COLORS = ['#10b981', '#6366f1', '#f59e0b', '#6b7280']

export default function ProjectDetailPage() {
  const { id } = useParams()
  const { setCurrentProject } = useProjectStore()

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const { data } = await api.get(`/projects/${id}`)
      setCurrentProject(data.data)
      return data.data
    },
  })

  const { data: storiesData } = useQuery({
    queryKey: ['stories', id],
    queryFn: async () => {
      const { data } = await api.get(`/stories/project/${id}`)
      return data.data
    },
  })

  const { data: epicsData } = useQuery({
    queryKey: ['epics', id],
    queryFn: async () => {
      const { data } = await api.get(`/stories/epics/${id}`)
      return data.data
    },
  })

  const stories = storiesData || []
  const epics = epicsData || []

  const statusCounts = {
    done: stories.filter((s) => s.status === 'done').length,
    in_progress: stories.filter((s) => s.status === 'in_progress').length,
    to_do: stories.filter((s) => ['to_do', 'approved'].includes(s.status)).length,
    draft: stories.filter((s) => s.status === 'draft').length,
  }

  const pieData = [
    { name: 'Done', value: statusCounts.done },
    { name: 'In Progress', value: statusCounts.in_progress },
    { name: 'To Do', value: statusCounts.to_do },
    { name: 'Draft', value: statusCounts.draft },
  ].filter((d) => d.value > 0)

  const epicsBarData = epics.map((e) => ({
    name: e.title.length > 20 ? e.title.slice(0, 17) + '...' : e.title,
    completion: e.completionPercentage,
    total: e.totalStories,
    done: e.completedStories,
  }))

  if (!project) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-4 mb-8">
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0"
          style={{ backgroundColor: project.color || '#6366f1' }}
        >
          {project.key?.slice(0, 2)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            <span className={`badge capitalize ${project.status === 'active' ? 'badge-done' : 'badge-draft'}`}>
              {project.status}
            </span>
          </div>
          <p className="text-gray-400 mt-1">{project.description || 'No description'}</p>
          <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
            {project.deadline && (
              <span className="flex items-center gap-1">
                <CalendarIcon className="w-4 h-4" />
                Deadline: {formatDate(project.deadline)}
              </span>
            )}
            {project.budget > 0 && (
              <span className="flex items-center gap-1">
                <CurrencyDollarIcon className="w-4 h-4" />
                ${project.budget?.toLocaleString()}
              </span>
            )}
            <span className="flex items-center gap-1">
              <UserGroupIcon className="w-4 h-4" />
              {project.memberCount} members
            </span>
          </div>
        </div>

        {/* Quick nav */}
        <div className="flex gap-2 flex-wrap">
          <Link to={`/projects/${id}/stories`} className="btn-primary btn-sm">
            <RocketLaunchIcon className="w-4 h-4" /> Stories
          </Link>
          <Link to={`/projects/${id}/documents`} className="btn-secondary btn-sm">
            <DocumentTextIcon className="w-4 h-4" /> Docs
          </Link>
          <Link to={`/projects/${id}/sprints`} className="btn-secondary btn-sm">
            <CodeBracketIcon className="w-4 h-4" /> Sprints
          </Link>
          <Link to={`/projects/${id}/insights`} className="btn-secondary btn-sm">
            <SparklesIcon className="w-4 h-4" /> Insights
          </Link>
        </div>
      </div>

      {/* Overall progress */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Overall Progress</h3>
          <span className="text-2xl font-bold text-gray-900">{project.completionPercentage}%</span>
        </div>
        <div className="progress-bar h-3">
          <div
            className={`progress-fill ${getProgressColor(project.completionPercentage)}`}
            style={{ width: `${project.completionPercentage}%` }}
          />
        </div>
        <div className="grid grid-cols-4 gap-4 mt-4">
          <Stat icon={CheckCircleIcon} label="Done" value={statusCounts.done} color="text-emerald-400" />
          <Stat icon={ClockIcon} label="In Progress" value={statusCounts.in_progress} color="text-blue-400" />
          <Stat icon={ExclamationCircleIcon} label="To Do" value={statusCounts.to_do} color="text-yellow-400" />
          <Stat icon={DocumentTextIcon} label="Draft" value={statusCounts.draft} color="text-gray-400" />
        </div>
      </div>

      {/* Integrations */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <IntegrationCard
          label="Jira"
          connected={project.jiraConnected}
          detail={project.jiraProjectKey}
          icon="🔗"
        />
        <IntegrationCard
          label="GitHub"
          connected={project.githubConnected}
          detail={project.githubRepo}
          icon="💻"
        />
        <div className="card p-3 text-center">
          <p className="text-xs text-gray-500 mb-1">Members</p>
          <p className="text-xl font-bold text-gray-900">{project.memberCount}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-gray-500 mb-1">Stories Total</p>
          <p className="text-xl font-bold text-gray-900">{project.totalStories}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Epic progress bars */}
        {epics.length > 0 && (
          <div className="card p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Epic Progress</h3>
            <div className="space-y-4">
              {epics.map((epic) => (
                <div key={epic._id}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-gray-700 truncate mr-2">{epic.title}</span>
                    <span className="text-gray-400 shrink-0">{epic.completionPercentage}%</span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className={`progress-fill ${getProgressColor(epic.completionPercentage)}`}
                      style={{ width: `${epic.completionPercentage}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {epic.completedStories}/{epic.totalStories} stories
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pie chart */}
        {pieData.length > 0 && (
          <div className="card p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Story Status Distribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#0d0d1e', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '8px', color: '#e2e8f0', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

const Stat = ({ icon: Icon, label, value, color }) => (
  <div className="text-center">
    <Icon className={`w-5 h-5 mx-auto mb-1 ${color}`} />
    <p className="text-lg font-bold text-gray-900">{value}</p>
    <p className="text-xs text-gray-500">{label}</p>
  </div>
)

const IntegrationCard = ({ label, connected, detail, icon }) => (
  <div className="card p-3">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-lg">{icon}</span>
      <span className="text-sm font-medium text-gray-700">{label}</span>
    </div>
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-gray-600'}`} />
      <span className="text-xs text-gray-500">
        {connected ? (detail || 'Connected') : 'Not connected'}
      </span>
    </div>
  </div>
)
