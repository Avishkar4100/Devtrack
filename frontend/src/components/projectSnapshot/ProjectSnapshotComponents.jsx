import { useState } from 'react'
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  FireIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline'
import { formatRelativeTime } from '@/lib/utils'

const HEALTH_CONFIG = {
  green: {
    label: 'Healthy',
    accent: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
    ring: 'from-emerald-400 to-teal-500',
  },
  amber: {
    label: 'Attention',
    accent: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
    ring: 'from-amber-400 to-orange-500',
  },
  red: {
    label: 'Risk',
    accent: 'border-rose-400/40 bg-rose-500/10 text-rose-200',
    ring: 'from-rose-400 to-red-500',
  },
}

const STATUS_META = {
  done: {
    label: 'Done',
    icon: CheckCircleIcon,
    track: 'bg-emerald-500/20',
    fill: 'bg-emerald-400',
    text: 'text-emerald-200',
  },
  in_progress: {
    label: 'In Progress',
    icon: ClockIcon,
    track: 'bg-amber-500/20',
    fill: 'bg-amber-400',
    text: 'text-amber-200',
  },
  partial: {
    label: 'Partial',
    icon: SparklesIcon,
    track: 'bg-sky-500/20',
    fill: 'bg-sky-400',
    text: 'text-sky-200',
  },
  not_started: {
    label: 'Not Started',
    icon: ExclamationTriangleIcon,
    track: 'bg-rose-500/20',
    fill: 'bg-rose-400',
    text: 'text-rose-200',
  },
}

const ISSUE_TYPE_META = {
  epic: {
    label: 'Epic',
    icon: FireIcon,
    accent: 'border-violet-500/30 bg-violet-500/10 text-violet-100',
  },
  story: {
    label: 'Story',
    icon: SparklesIcon,
    accent: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100',
  },
  task: {
    label: 'Task',
    icon: WrenchScrewdriverIcon,
    accent: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  },
  subtask: {
    label: 'Sub-task',
    icon: WrenchScrewdriverIcon,
    accent: 'border-slate-500/30 bg-slate-500/10 text-slate-100',
  },
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const toneForHealth = (value = 'amber') => HEALTH_CONFIG[String(value || 'amber').toLowerCase()] || HEALTH_CONFIG.amber

const toneForStatus = (value = 'not_started') => STATUS_META[String(value || 'not_started').toLowerCase()] || STATUS_META.not_started

const toneForIssueType = (value = 'story') => ISSUE_TYPE_META[String(value || 'story').toLowerCase()] || ISSUE_TYPE_META.story

const renderList = (items = [], fallback = 'No items') => {
  if (!Array.isArray(items) || items.length === 0) return <span>{fallback}</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.slice(0, 4).map((item) => (
        <span key={item} className="px-2 py-1 rounded-full border border-white/10 bg-white/5 text-[11px] text-slate-200">
          {item}
        </span>
      ))}
    </div>
  )
}

export function SnapshotSummaryHero({ summary, totals = {}, sourceMeta = {} }) {
  const health = toneForHealth(summary?.deliveryHealth)

  return (
    <div className="card p-5 border border-white/10 bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${health.accent}`}>
              <span className={`w-2 h-2 rounded-full bg-gradient-to-r ${health.ring}`} />
              {health.label}
            </span>
            <span className="px-3 py-1 rounded-full border border-white/10 bg-white/5 text-xs text-slate-300">
              {summary?.headline || 'Delivery snapshot'}
            </span>
          </div>

          <div>
            <h3 className="text-xl font-bold text-slate-50">{summary?.headline || 'Delivery Snapshot'}</h3>
            <p className="text-sm text-slate-300 mt-2 leading-6 max-w-3xl">
              {summary?.summary || 'The AI snapshot is waiting for structured issue checks.'}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 mb-1">Top Risk</p>
              <p className="text-sm text-slate-200 leading-6">{summary?.topRisk || 'No top risk identified yet.'}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 mb-1">Next Action</p>
              <p className="text-sm text-slate-200 leading-6">{summary?.nextAction || 'No next action identified yet.'}</p>
            </div>
          </div>
        </div>

        <div className="lg:w-1/3 min-w-[260px] rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Progress</p>
              <p className="text-3xl font-black text-slate-50 mt-1">{totals.completionPct ?? 0}%</p>
            </div>
            <div className="text-right min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Source</p>
              <p className="text-sm font-semibold text-slate-200 mt-1 truncate max-w-[100px]" title={sourceMeta?.mode || 'unknown'}>
                {sourceMeta?.mode || 'unknown'}
              </p>
            </div>
          </div>
          <div className="mt-4 h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full rounded-full bg-gradient-to-r ${health.ring}`} style={{ width: `${totals.completionPct ?? 0}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
            <Metric label="Total Issues" value={totals.total || 0} />
            <Metric label="Done" value={totals.done || 0} />
            <Metric label="In Progress" value={totals.inProgress || 0} />
            <Metric label="Not Started" value={totals.notStarted || 0} />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
            <Metric label="AI-Verified" value={totals.matchedCount ?? sourceMeta?.matchedIssueCount ?? 0} />
            <Metric label="Unmatched" value={totals.unmatchedCount ?? sourceMeta?.unmatchedIssueCount ?? 0} />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
            <Metric label="Trace" value={`${totals.commitCoveragePct || 0}%`} />
            <Metric label="Match Rate" value={`${totals.matchRatePct || 0}%`} />
          </div>
          <div className="mt-3 pt-3 border-t border-white/5">
            <div className="rounded-lg bg-white/5 px-3 py-2 text-center">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Full Backlog</p>
              <p className="text-lg font-black text-slate-100 mt-0.5">{sourceMeta?.jiraBacklogCount || totals.total || 0} issues</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function IssueProgressSection({ title, subtitle, items = [], emptyMessage = 'No issues found.', maxVisible = 25, accent = 'slate' }) {
  const [showAll, setShowAll] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const displayItems = showAll || items.length <= maxVisible ? items : items.slice(0, maxVisible)
  const hiddenCount = items.length - maxVisible

  const accents = {
    slate: 'border-slate-500/20 bg-slate-500/5',
    amber: 'border-amber-500/20 bg-amber-500/5',
    emerald: 'border-emerald-500/20 bg-emerald-500/5',
  }
  const accentBorder = accents[accent] || accents.slate

  return (
    <section className={`card p-3 border ${accentBorder}`}>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          {subtitle && !collapsed && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
            {items.length}
          </span>
          <ChevronDownIcon className={`w-3.5 h-3.5 text-slate-500 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
        </div>
      </button>

      {!collapsed && (
        <div className="mt-3">
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 bg-white/5 p-3 text-xs text-slate-400">
              {emptyMessage}
            </div>
          ) : (
            <>
              <div className="grid gap-2">
                {displayItems.map((issue) => (
                  <IssueProgressCard key={`${issue.issueKey}-${issue.issueType}`} issue={issue} />
                ))}
              </div>
              {!showAll && hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowAll(true) }}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
                >
                  <ChevronDownIcon className="w-3 h-3" />
                  Show {hiddenCount} more
                </button>
              )}
              {showAll && items.length > maxVisible && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowAll(false) }}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
                >
                  <ChevronUpIcon className="w-3 h-3" />
                  Show fewer
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function SnapshotRollupSection({ title, subtitle, items = [], emptyMessage = 'No items found.', kind = 'epic' }) {
  const [collapsed, setCollapsed] = useState(false)
  const accentColors = kind === 'epic'
    ? 'border-violet-500/20 bg-violet-500/5'
    : 'border-sky-500/20 bg-sky-500/5'
  const accentText = kind === 'epic' ? 'text-violet-400' : 'text-sky-400'
  const badgeAccent = kind === 'epic'
    ? 'border-violet-400/30 bg-violet-500/10 text-violet-200'
    : 'border-sky-400/30 bg-sky-500/10 text-sky-200'

  return (
    <section className={`card p-3 border-l-2 ${kind === 'epic' ? 'border-l-violet-500' : 'border-l-sky-500'} ${accentColors}`}>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${badgeAccent}`}>
              {kind === 'epic' ? '⚡ Epics' : '👥 Team'}
            </span>
            <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          </div>
          {subtitle && !collapsed && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
            {items.length}
          </span>
          <ChevronDownIcon className={`w-3.5 h-3.5 text-slate-500 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
        </div>
      </button>

      {!collapsed && (
        <div className="mt-3">
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 bg-white/5 p-3 text-xs text-slate-400">
              {emptyMessage}
            </div>
          ) : (
            <div className="grid gap-2">
              {items.map((item) => (
                <SnapshotRollupCard key={`${kind}-${item.epic || item.owner || item.issueKey}`} item={item} kind={kind} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function IssueProgressCard({ issue }) {
  const [expanded, setExpanded] = useState(false)
  const typeMeta = toneForIssueType(issue?.issueType)
  const statusMeta = toneForStatus(issue?.status)
  const StatusIcon = statusMeta.icon
  const TypeIcon = typeMeta.icon
  const progress = clamp(Number(issue?.progressPct || 0), 0, 100)
  const isAiVerified = (issue?.linkedCommitCount || 0) > 0 || (issue?.confidence || 0) > 40
  const isBacklogOnly = !isAiVerified && issue?.status === 'not_started'

  return (
    <article className={`rounded-xl border ${isBacklogOnly ? 'border-white/5 bg-slate-950/40 opacity-70' : 'border-white/10 bg-slate-950/60'} transition-all`}>
      {/* Compact header row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.02] rounded-xl transition-colors"
      >
        {/* Left: Issue info */}
        <div className="min-w-0 flex-1 flex items-center gap-2.5">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${typeMeta.accent} shrink-0`}>
            <TypeIcon className="w-3 h-3" />
            {typeMeta.label}
          </span>
          <span className="text-[11px] font-mono text-slate-400 shrink-0">{issue?.issueKey}</span>
          <span className="text-xs text-slate-200 truncate">{issue?.title || issue?.issueKey}</span>
          {isAiVerified && (
            <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border border-indigo-400/30 bg-indigo-500/10 text-indigo-300 shrink-0">AI</span>
          )}
        </div>

        {/* Right: Status + Progress */}
        <div className="flex items-center gap-3 shrink-0">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusMeta.track} ${statusMeta.text} shrink-0`}>
            <StatusIcon className="w-3 h-3" />
            {statusMeta.label}
          </span>
          <div className="hidden sm:flex items-center gap-2 min-w-[100px]">
            <div className="h-1.5 flex-1 rounded-full bg-slate-800 overflow-hidden">
              <div className={`h-full rounded-full ${statusMeta.fill} transition-all`} style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[11px] font-semibold text-slate-300 w-8 text-right">{progress}%</span>
          </div>
          <ChevronDownIcon className={`w-3.5 h-3.5 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2.5">
          {/* Summary text */}
          {issue?.summary && (
            <p className="text-xs text-slate-400 leading-5">{issue.summary}</p>
          )}

          {/* Key fields in a compact grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px]">
            <TinyPill label="Owner" value={issue?.owner || 'Unassigned'} />
            <TinyPill label="Epic" value={issue?.epic || 'General'} />
            <TinyPill label="Priority" value={issue?.priority || 'medium'} />
            <TinyPill label="Confidence" value={`${clamp(Number(issue?.confidence || 0), 0, 100)}%`} />
            <TinyPill label="Who" value={issue?.whoDidWhat || issue?.owner || '-'} />
            <TinyPill label="What changed" value={issue?.whatChanged || '-'} />
            <TinyPill label="Commits" value={String(issue?.linkedCommitCount || 0)} />
            <TinyPill label="Progress" value={`${progress}%`} />
          </div>

          {/* Evidence */}
          {Array.isArray(issue?.evidence) && issue.evidence.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {issue.evidence.slice(0, 3).map((e) => (
                <span key={e} className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-slate-400">{e}</span>
              ))}
            </div>
          )}

          {/* Matched commits */}
          {Array.isArray(issue?.linkedCommits) && issue.linkedCommits.length > 0 && (
            <div className="space-y-1">
              {issue.linkedCommits.slice(0, 2).map((commit) => (
                <div key={commit.sha + commit.message} className="text-[10px] text-slate-500 flex items-center gap-2">
                  <span className="font-mono text-slate-400">{commit.sha}</span>
                  <span className="truncate">{commit.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function TinyPill({ label, value }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-2 py-1">
      <p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-[11px] text-slate-200 mt-0.5 truncate">{value}</p>
    </div>
  )
}

function SnapshotRollupCard({ item, kind = 'epic' }) {
  const [expanded, setExpanded] = useState(false)
  const progress = clamp(Number(item?.progressPct || 0), 0, 100)
  const isTeam = kind === 'team'
  const accentBar = isTeam ? 'bg-sky-400' : 'bg-violet-400'
  const accentBorder = isTeam ? 'border-sky-500/20' : 'border-violet-500/20'

  // ── TEAM CARD: distinct rich design ──
  if (isTeam) {
    return (
      <article className={`rounded-xl border ${accentBorder} bg-gradient-to-br from-sky-950/30 via-slate-950 to-slate-950 transition-all overflow-hidden`}>
        <button type="button" onClick={() => setExpanded(!expanded)} className="w-full text-left hover:bg-white/[0.02] transition-colors">
          {/* Header bar with avatar-style initial + name + progress */}
          <div className="flex items-center gap-3 px-3 py-2.5">
            {/* Avatar circle */}
            <div className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-sky-500/20">
              {String(item?.owner || '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-slate-100 truncate">{item?.owner || 'Unassigned'}</h4>
                <span className={`text-[10px] font-bold ml-auto ${progress >= 70 ? 'text-emerald-400' : progress >= 30 ? 'text-amber-400' : 'text-rose-400'}`}>
                  {progress}%
                </span>
                <ChevronDownIcon className={`w-3.5 h-3.5 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </div>
              {/* Compact progress bar */}
              <div className="mt-1.5 h-2 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-400 transition-all" style={{ width: `${progress}%` }} />
              </div>
              {/* Stat pills */}
              <div className="flex items-center gap-3 mt-2 text-[10px]">
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-semibold">{item?.doneCount || 0} done</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-semibold">{item?.inProgressCount || 0} active</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400 font-semibold">{item?.notStartedCount || 0} todo</span>
              </div>
              {/* Summary snippet */}
              <p className="text-[11px] text-slate-400 mt-1.5 leading-4 line-clamp-2">{item?.summary || 'No summary yet.'}</p>
            </div>
          </div>
        </button>

        {/* Expanded details */}
        {expanded && (
          <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2.5 bg-slate-950/50">
            {/* Focus & Next Action - two column */}
            <div className="grid grid-cols-1 gap-2">
              {item?.currentFocus && (
                <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-sky-400 font-semibold">🎯 Current Focus</p>
                  <p className="text-xs text-slate-200 mt-0.5 leading-5">{item.currentFocus}</p>
                </div>
              )}
              {item?.nextAction && (
                <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold">📋 Next Action</p>
                  <p className="text-xs text-slate-200 mt-0.5 leading-5">{item.nextAction}</p>
                </div>
              )}
            </div>

            {/* Strengths & Risk */}
            <div className="grid grid-cols-1 gap-2">
              {item?.strengths && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">💪 Strengths</p>
                  <p className="text-xs text-slate-200 mt-0.5 leading-5">{item.strengths}</p>
                </div>
              )}
              {item?.risk && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-rose-400 font-semibold">⚠️ Risk</p>
                  <p className="text-xs text-slate-200 mt-0.5 leading-5">{item.risk}</p>
                </div>
              )}
            </div>

            {/* Completed issues */}
            {item?.topDoneIssues?.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-1.5">✅ Completed Issues</p>
                <div className="flex flex-wrap gap-1">
                  {item.topDoneIssues.map((k) => (
                    <span key={k} className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">{k}</span>
                  ))}
                </div>
              </div>
            )}

            {/* All issue keys */}
            {item?.issueKeys?.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">📦 All Issues ({item.issueKeys.length})</p>
                <div className="flex flex-wrap gap-1">
                  {item.issueKeys.slice(0, 12).map((k) => (
                    <span key={k} className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-slate-300">{k}</span>
                  ))}
                  {item.issueKeys.length > 12 && (
                    <span className="text-[10px] text-slate-500">+{item.issueKeys.length - 12} more</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </article>
    )
  }

  // ── EPIC CARD: compact violet design ──
  return (
    <article className={`rounded-lg border ${accentBorder} bg-slate-950/50 transition-all`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 px-2.5 py-2 text-left hover:bg-white/[0.02] rounded-lg transition-colors"
      >
        <div className="shrink-0 pt-0.5">
          <div className="w-1.5 h-10 rounded-full bg-slate-800 overflow-hidden">
            <div className={`w-full rounded-full ${accentBar} transition-all`} style={{ height: `${progress}%`, marginTop: 'auto' }} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-xs font-semibold text-slate-100 truncate">
              {item?.title || item?.epic || 'General'}
            </h4>
            {item?.title && item?.title !== item?.epic && (
              <span className="text-[10px] font-mono text-slate-500">{item?.epic}</span>
            )}
            <span className="text-[10px] font-semibold text-slate-400 ml-auto">{progress}%</span>
            <ChevronDownIcon className={`w-3 h-3 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-4 line-clamp-2">{item?.summary || 'No summary yet.'}</p>
          <div className="mt-1.5 h-1 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full rounded-full ${accentBar} transition-all`} style={{ width: `${progress}%` }} />
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[10px]">
            <span className="text-emerald-400">{item?.doneCount || 0} done</span>
            <span className="text-amber-400">{item?.inProgressCount || 0} in progress</span>
            <span className="text-slate-500">{item?.notStartedCount || 0} not started</span>
            {item?.owners?.length > 0 && (
              <span className="text-slate-500 truncate ml-auto">{item.owners.slice(0, 2).join(', ')}</span>
            )}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-white/5 pt-2">
          {item?.owners?.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-[10px] text-slate-500">Owners:</span>
              {item.owners.map((o) => (
                <span key={o} className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-slate-300">{o}</span>
              ))}
            </div>
          )}
          {item?.issueKeys?.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-[10px] text-slate-500">Issues:</span>
              {item.issueKeys.slice(0, 8).map((k) => (
                <span key={k} className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-slate-300">{k}</span>
              ))}
              {item.issueKeys.length > 8 && <span className="text-[10px] text-slate-500">+{item.issueKeys.length - 8} more</span>}
            </div>
          )}
          {item?.topIssues?.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-slate-500">Top Issues</p>
              {item.topIssues.slice(0, 5).map((issue) => (
                <div key={issue.issueKey} className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="font-mono text-slate-300">{issue.issueKey}</span>
                  <span className="text-slate-500 truncate">{issue.summary || issue.status}</span>
                  <span className="text-slate-400 shrink-0">{issue.progressPct}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export function SnapshotLogPanel({ logs = [] }) {
  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100">Snapshot Logs</h3>
          <p className="text-xs text-slate-400 mt-1">What the snapshot actually used while building the AI checks</p>
        </div>
        <span className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-slate-300">
          {logs.length} log lines
        </span>
      </div>

      {logs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-400">
          No debug logs available yet.
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log, index) => (
            <details key={`${log.label}-${index}`} className="group rounded-2xl border border-white/10 bg-slate-950/60 p-3">
              <summary className="cursor-pointer list-none flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] px-2 py-1 rounded-full border ${
                      log.level === 'success'
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                        : log.level === 'warning'
                          ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                          : log.level === 'error'
                            ? 'border-rose-500/20 bg-rose-500/10 text-rose-200'
                            : 'border-white/10 bg-white/5 text-slate-300'
                    }`}>
                      {String(log.level || 'info').toUpperCase()}
                    </span>
                    <span className="text-sm font-semibold text-slate-100">{log.label}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-5">{log.message}</p>
                </div>
                <span className="text-xs text-slate-500 group-open:text-slate-400">Expand</span>
              </summary>

              {log.meta && (
                <div className="mt-3 grid gap-2 text-xs">
                  {Object.entries(log.meta).map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{key}</p>
                      <p className="text-slate-200 mt-1 break-words">
                        {typeof value === 'string' ? value : JSON.stringify(value)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </details>
          ))}
        </div>
      )}
    </section>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-100 mt-1">{value}</p>
    </div>
  )
}

function InfoPill({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-100 mt-1 break-words">{value}</p>
    </div>
  )
}
