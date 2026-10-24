import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  ExternalLink,
  Hash,
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
  Layers,
  ArrowRight,
  Info,
} from 'lucide-react'
import { api, useApi } from '../api'
import { Card, Drawer, ErrorBox, Loading, cx, fmtTs } from '../ui'

const ACTION_COLORS: Record<string, string> = {
  RECEIVED: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  ASSIGNED: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  REMARK: 'bg-slate-100 text-slate-700 ring-slate-600/20',
  TRANSFER: 'bg-purple-50 text-purple-700 ring-purple-600/20',
  ESCALATE: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  AUTO_ESCALATE: 'bg-red-50 text-red-700 ring-red-600/20',
  DISPOSE: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  COORDINATION: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  OVERLAP_CONFIRMED: 'bg-rose-50 text-rose-700 ring-rose-600/20',
}

const ACTION_TYPES = [
  '',
  'RECEIVED',
  'ASSIGNED',
  'REMARK',
  'TRANSFER',
  'ESCALATE',
  'AUTO_ESCALATE',
  'DISPOSE',
  'COORDINATION',
  'OVERLAP_CONFIRMED',
]

const BUREAUS = ['', 'RB', 'PGRC', 'AB', 'LC', 'VIG', 'SYS']

export default function AuditVault() {
  const [sp, setSp] = useSearchParams()
  const [page, setPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(50)
  const [selectedRecord, setSelectedRecord] = useState<any>(null)

  const [verifyState, setVerifyState] = useState<{
    running: boolean
    result: any | null
    error: string | null
  }>({
    running: false,
    result: null,
    error: null,
  })

  // URL search param filters
  const caseIdFilter = sp.get('case_id') || ''
  const actionTypeFilter = sp.get('action_type') || ''
  const bureauFilter = sp.get('actor_bureau') || ''
  const dateFromFilter = sp.get('date_from') || ''
  const dateToFilter = sp.get('date_to') || ''

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(sp)
    v ? next.set(k, v) : next.delete(k)
    setSp(next, { replace: true })
    setPage(1)
  }

  const clearAllFilters = () => {
    setSp(new URLSearchParams(), { replace: true })
    setPage(1)
  }

  // Build query string for ledger endpoint
  const queryParams = new URLSearchParams()
  if (caseIdFilter) queryParams.set('case_id', caseIdFilter)
  if (actionTypeFilter) queryParams.set('action_type', actionTypeFilter)
  if (bureauFilter) queryParams.set('actor_bureau', bureauFilter)
  if (dateFromFilter) queryParams.set('date_from', dateFromFilter)
  if (dateToFilter) queryParams.set('date_to', dateToFilter)
  queryParams.set('page', String(page))
  queryParams.set('page_size', String(pageSize))

  const { data, error, loading, reload } = useApi<any>(`/audit/ledger?${queryParams.toString()}`)

  async function handleVerifyChain() {
    setVerifyState({ running: true, result: null, error: null })
    try {
      const res = await api('/audit/verify')
      setVerifyState({ running: false, result: res, error: null })
    } catch (err: any) {
      setVerifyState({ running: false, result: null, error: err.message || 'Verification failed' })
    }
  }

  const items = data?.items || []
  const total = data?.total || 0
  const actionCounts = data?.action_counts || {}
  const totalPages = Math.ceil(total / pageSize) || 1
  const hasFilters = Boolean(
    caseIdFilter || actionTypeFilter || bureauFilter || dateFromFilter || dateToFilter
  )

  return (
    <div className="mx-auto max-w-[1350px] space-y-4">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Audit Vault &amp; Immutable Ledger</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-semibold text-slate-100 shadow-xs">
              <ShieldCheck size={12} className="text-emerald-400" />
              TAMPER-EVIDENT HASH CHAIN
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Cryptographically chained SHA-256 audit ledger across all grievance workflow actions, transfers, assignments, and coordination decisions.
          </p>
        </div>

        {/* Global Verification Button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleVerifyChain}
            disabled={verifyState.running}
            className="inline-flex items-center gap-2 rounded-lg bg-navy px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-navy-dark disabled:opacity-50 transition"
          >
            <RotateCw size={14} className={verifyState.running ? 'animate-spin' : ''} />
            {verifyState.running ? 'Verifying Hashes…' : 'Verify Chain Integrity'}
          </button>
        </div>
      </div>

      {/* Verification Status Banner */}
      {verifyState.result && (
        <div
          className={cx(
            'flex items-start justify-between gap-3 rounded-xl border p-4 text-sm transition',
            verifyState.result.ok
              ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          )}
        >
          <div className="flex items-start gap-2.5">
            {verifyState.result.ok ? (
              <CheckCircle2 size={18} className="mt-0.5 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle size={18} className="mt-0.5 text-red-600 shrink-0" />
            )}
            <div>
              <div className="font-bold">
                {verifyState.result.ok
                  ? `Audit Chain Verified Intact (${verifyState.result.checked.toLocaleString()} records)`
                  : 'Tamper Detected in Hash Chain!'}
              </div>
              <div className="mt-0.5 text-xs leading-relaxed opacity-90">
                {verifyState.result.ok ? (
                  <>
                    Every audit record linked to genesis ({'0'.repeat(8)}…) matches its cryptographic SHA-256 hash. Zero sequence gaps or altered remarks detected.
                  </>
                ) : (
                  <>
                    First broken link detected at Case{' '}
                    <span className="font-mono font-bold">{verifyState.result.first_break?.case_id}</span>, Sequence #{' '}
                    <span className="font-bold">{verifyState.result.first_break?.seq}</span>. Reason:{' '}
                    <span className="font-semibold underline">{verifyState.result.first_break?.reason}</span>.
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!verifyState.result.ok && verifyState.result.first_break?.case_id && (
              <Link
                to={`/cases/${verifyState.result.first_break.case_id}`}
                className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-red-700"
              >
                Inspect Case <ExternalLink size={12} />
              </Link>
            )}
            <button
              onClick={() => setVerifyState({ running: false, result: null, error: null })}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Educational Notice Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-600">
        <div className="flex items-center gap-2.5">
          <Info size={15} className="text-slate-500 shrink-0" />
          <span className="leading-normal">
            <strong className="text-slate-800">Tamper-evident guarantee:</strong> This audit vault is <strong>tamper-evident</strong>, not tamper-proof — any unauthorized modification breaks subsequent SHA-256 hashes and is immediately flagged upon integrity verification.
          </span>
        </div>
        <a
          href="https://github.com/Krutikaa04/SIH_Demo/blob/master/PROJECT_HANDOFF.md#standout-features-a-k-and-extras"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-navy hover:underline shrink-0"
        >
          Learn more in docs <ExternalLink size={12} />
        </a>
      </div>

      {/* KPI Counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-white p-4 shadow-xs ring-1 ring-slate-200/70">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Audit Events</span>
          <span className="mt-1 block text-2xl font-bold text-slate-900">{total.toLocaleString()}</span>
          <span className="text-xs text-slate-500">Recorded action events</span>
        </div>

        <div className="rounded-xl bg-white p-4 shadow-xs ring-1 ring-slate-200/70">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Auto-Escalations</span>
          <span className="mt-1 block text-2xl font-bold text-red-600">
            {(actionCounts['AUTO_ESCALATE'] || 0).toLocaleString()}
          </span>
          <span className="text-xs text-slate-500">Triggered by SLA engine</span>
        </div>

        <div className="rounded-xl bg-white p-4 shadow-xs ring-1 ring-slate-200/70">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Transfers &amp; Remarks</span>
          <span className="mt-1 block text-2xl font-bold text-purple-700">
            {((actionCounts['TRANSFER'] || 0) + (actionCounts['REMARK'] || 0)).toLocaleString()}
          </span>
          <span className="text-xs text-slate-500">Cross-bureau workflow</span>
        </div>

        <div className="rounded-xl bg-white p-4 shadow-xs ring-1 ring-slate-200/70">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Disposals Logged</span>
          <span className="mt-1 block text-2xl font-bold text-emerald-600">
            {(actionCounts['DISPOSE'] || 0).toLocaleString()}
          </span>
          <span className="text-xs text-slate-500">Case closures recorded</span>
        </div>
      </div>

      {/* Quick Filter Action Pills */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
          Quick Filters:
        </span>
        {[
          { label: 'All Events', value: '' },
          { label: 'Auto-Escalated', value: 'AUTO_ESCALATE' },
          { label: 'Transfers', value: 'TRANSFER' },
          { label: 'Escalations', value: 'ESCALATE' },
          { label: 'Remarks', value: 'REMARK' },
          { label: 'Disposals', value: 'DISPOSE' },
          { label: 'Coordination', value: 'COORDINATION' },
          { label: 'Overlap Confirmed', value: 'OVERLAP_CONFIRMED' },
        ].map((pill) => {
          const isSelected = (!pill.value && !actionTypeFilter) || actionTypeFilter === pill.value
          const count = pill.value ? actionCounts[pill.value] || 0 : total
          return (
            <button
              key={pill.value || 'all'}
              type="button"
              onClick={() => setParam('action_type', pill.value)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition',
                isSelected
                  ? 'bg-navy text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <span>{pill.label}</span>
              <span
                className={cx(
                  'rounded-full px-1.5 py-0.2 text-[10px] font-bold',
                  isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                )}
              >
                {count.toLocaleString()}
              </span>
            </button>
          )
        })}
      </div>

      {/* Filter Bar */}
      <Card pad={false}>
        <div className="grid grid-cols-2 gap-3 p-3.5 sm:grid-cols-3 lg:grid-cols-6 items-end">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Case ID</span>
            <div className="relative">
              <input
                type="text"
                placeholder="e.g. RB/2026/..."
                value={caseIdFilter}
                onChange={(e) => setParam('case_id', e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-navy"
              />
              {caseIdFilter && (
                <button
                  onClick={() => setParam('case_id', '')}
                  className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Action Type</span>
            <select
              value={actionTypeFilter}
              onChange={(e) => setParam('action_type', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-navy"
            >
              <option value="">All Actions</option>
              {ACTION_TYPES.filter(Boolean).map((t) => (
                <option key={t} value={t}>
                  {t} {actionCounts[t] ? `(${actionCounts[t]})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Actor Bureau</span>
            <select
              value={bureauFilter}
              onChange={(e) => setParam('actor_bureau', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-navy"
            >
              <option value="">All Bureaus</option>
              {BUREAUS.filter(Boolean).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">From Date</span>
            <input
              type="date"
              value={dateFromFilter}
              onChange={(e) => setParam('date_from', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-navy"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">To Date</span>
            <input
              type="date"
              value={dateToFilter}
              onChange={(e) => setParam('date_to', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-navy"
            />
          </label>

          {hasFilters && (
            <div className="flex items-center pb-0.5">
              <button
                type="button"
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                <X size={12} /> Clear filters
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* Ledger Table Card */}
      <Card pad={false}>
        {loading && !data ? (
          <Loading label="Loading audit ledger events…" />
        ) : error && !data ? (
          <ErrorBox msg={error} />
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Layers size={24} className="mx-auto mb-2 text-slate-300" />
            <div className="text-sm font-semibold text-slate-700">No audit records match the current filters</div>
            <div className="text-xs text-slate-400 mt-1">Try clearing filters or adjusting your date range.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Case ID</th>
                  <th className="px-4 py-3">Institution &amp; Region</th>
                  <th className="px-4 py-3">Action Type</th>
                  <th className="px-4 py-3">Actor / Bureau</th>
                  <th className="px-4 py-3">Remarks / Description</th>
                  <th className="px-4 py-3 font-mono">Block Hash</th>
                  <th className="px-4 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((row: any) => {
                  const badgeColor =
                    ACTION_COLORS[row.action_type] || 'bg-slate-100 text-slate-700 ring-slate-600/20'
                  const shortHash = row.hash ? row.hash.slice(0, 10) + '…' : '—'
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedRecord(row)}
                      className="cursor-pointer hover:bg-slate-50/80 transition"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">
                        {fmtTs(row.ts)}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link
                          to={`/cases/${row.case_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-xs font-semibold text-navy hover:underline inline-flex items-center gap-1"
                        >
                          {row.case_id}
                          <ExternalLink size={10} className="text-slate-400" />
                        </Link>
                        <div className="text-[10px] text-slate-400 font-mono">Seq #{row.seq}</div>
                      </td>

                      <td className="max-w-[200px] px-4 py-3">
                        <div className="truncate font-medium text-slate-800" title={row.institution_name}>
                          {row.institution_name}
                        </div>
                        <div className="text-xs text-slate-400">{row.region}</div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={cx(
                            'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
                            badgeColor
                          )}
                        >
                          {row.action_type}
                        </span>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap text-xs">
                        <div className="font-medium text-slate-800">{row.actor_name || row.actor_id}</div>
                        <div className="text-[11px] text-slate-400">Bureau {row.actor_bureau}</div>
                      </td>

                      <td className="max-w-[280px] px-4 py-3 text-xs text-slate-600">
                        <div className="truncate" title={row.remarks}>
                          {row.remarks || '—'}
                        </div>
                        {(row.from_bureau || row.to_bureau) && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {row.from_bureau && <span>From: {row.from_bureau} </span>}
                            {row.to_bureau && <span>To: {row.to_bureau}</span>}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-500">
                        <span
                          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700"
                          title={`Hash: ${row.hash}\nPrev: ${row.prev_hash}`}
                        >
                          {shortHash}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedRecord(row)
                          }}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <div>
              Showing <span className="font-semibold text-slate-800">{(page - 1) * pageSize + 1}</span> to{' '}
              <span className="font-semibold text-slate-800">{Math.min(page * pageSize, total)}</span> of{' '}
              <span className="font-semibold text-slate-800">{total.toLocaleString()}</span> events
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <span>Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(1)
                  }}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </label>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-md border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  title="Previous page"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="px-2 font-medium text-slate-700">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-md border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  title="Next page"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Record Inspection Drawer */}
      <Drawer
        open={Boolean(selectedRecord)}
        onClose={() => setSelectedRecord(null)}
        width={620}
        title={
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Audit Block Verification</h2>
              <span className="font-mono text-xs font-semibold text-slate-500">
                Seq #{selectedRecord?.seq}
              </span>
            </div>
            <p className="text-xs text-slate-500">Case {selectedRecord?.case_id}</p>
          </div>
        }
      >
        {selectedRecord && (
          <div className="space-y-4 text-xs">
            {/* Metadata Summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Action</span>
                <span className="mt-0.5 block font-bold text-slate-900">{selectedRecord.action_type}</span>
              </div>

              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Timestamp</span>
                <span className="mt-0.5 block font-medium text-slate-800">{fmtTs(selectedRecord.ts)}</span>
              </div>

              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Actor</span>
                <span className="mt-0.5 block font-medium text-slate-800">
                  {selectedRecord.actor_name || selectedRecord.actor_id} (Bureau {selectedRecord.actor_bureau})
                </span>
              </div>

              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Institution</span>
                <span className="mt-0.5 block font-medium text-slate-800 truncate" title={selectedRecord.institution_name}>
                  {selectedRecord.institution_name} ({selectedRecord.region})
                </span>
              </div>
            </div>

            {/* Remarks */}
            <div>
              <span className="mb-1 block font-semibold text-slate-700">Action Remarks &amp; Notes</span>
              <div className="rounded-lg border border-slate-200 bg-white p-3 font-medium text-slate-800 shadow-xs leading-relaxed">
                {selectedRecord.remarks || 'No remarks recorded.'}
              </div>
            </div>

            {/* Cryptographic Hashes */}
            <div className="space-y-2">
              <span className="block font-semibold text-slate-700">Cryptographic Hash Chain</span>

              <div>
                <span className="mb-0.5 block font-mono text-[11px] text-slate-400">Current Block SHA-256 Hash:</span>
                <div className="break-all rounded-lg border border-slate-200 bg-slate-900 p-2.5 font-mono text-[11px] text-emerald-400 shadow-inner">
                  {selectedRecord.hash}
                </div>
              </div>

              <div>
                <span className="mb-0.5 block font-mono text-[11px] text-slate-400">Previous Block Hash (prev_hash):</span>
                <div className="break-all rounded-lg border border-slate-200 bg-slate-900 p-2.5 font-mono text-[11px] text-slate-300 shadow-inner">
                  {selectedRecord.prev_hash}
                </div>
              </div>
            </div>

            {/* Link to Case */}
            <div className="pt-2 text-right">
              <Link
                to={`/cases/${selectedRecord.case_id}`}
                className="inline-flex items-center gap-1.5 font-semibold text-navy hover:underline"
              >
                Open Full Case Details <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
