import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

export default function AdminOverviewPage() {
  const { data: overview } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: async () => (await api.get('/admin/overview')).data.data,
  })

  const usageByDay = overview?.usage?.usageByDay || []
  const topActions = overview?.usage?.topActions || []

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Platform Overview</h1>
        <p className="text-sm text-slate-400">Executive-level visibility into user, organization, project, and platform usage trends.</p>
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        <StatCard label="Total Users" value={overview?.users?.total || 0} />
        <StatCard label="Active Users" value={overview?.users?.active || 0} />
        <StatCard label="Active Organizations" value={overview?.organizations?.active || 0} />
        <StatCard label="Total Projects" value={overview?.projects?.total || 0} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-4 space-y-3">
          <h2 className="text-base font-semibold text-gray-100">Usage (Last 30 days)</h2>
          <div className="space-y-2 max-h-72 overflow-auto">
            {usageByDay.length === 0 && <p className="text-sm text-slate-400">No recent usage logs.</p>}
            {usageByDay.map((d) => (
              <div key={d._id} className="flex items-center justify-between border border-slate-700/60 rounded-lg px-3 py-2">
                <span className="text-xs text-slate-300">{d._id}</span>
                <span className="text-xs font-semibold text-slate-100">{d.count} actions</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <h2 className="text-base font-semibold text-gray-100">Top Admin/Platform Actions</h2>
          <div className="space-y-2 max-h-72 overflow-auto">
            {topActions.length === 0 && <p className="text-sm text-slate-400">No action trends available.</p>}
            {topActions.map((item) => (
              <div key={item._id} className="flex items-center justify-between border border-slate-700/60 rounded-lg px-3 py-2">
                <span className="text-xs text-slate-300">{item._id || 'unknown'}</span>
                <span className="text-xs font-semibold text-slate-100">{item.count}</span>
              </div>
            ))}
          </div>
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
