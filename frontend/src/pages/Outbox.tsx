import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, MessageSquare, Send, ShieldCheck, Clock, User, Eye, ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { useApi } from '../api'
import { Card, Drawer, ErrorBox, Loading, ago, cx, fmtTs } from '../ui'

const CHANNELS = [
  ['', 'All Channels'],
  ['email', 'Email'],
  ['sms', 'SMS'],
]

export default function Outbox() {
  const [channel, setChannel] = useState('')
  const [selectedItem, setSelectedItem] = useState<any>(null)
  const { data, error, loading, reload } = useApi<any>('/outbox' + (channel ? `?channel=${channel}` : ''))

  const items = data?.items || []

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Simulated Outbox</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              <ShieldCheck size={12} />
              SIMULATED · OFFLINE
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Dispatch archive for grievance reminders and escalation notices. Operates strictly offline without external network transmission.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/alerts"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Send size={14} className="text-navy" />
            Go to Alerts to dispatch
          </Link>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {CHANNELS.map(([v, l]) => (
          <button
            key={v}
            onClick={() => setChannel(v)}
            className={cx(
              'rounded-full px-3.5 py-1.5 text-sm font-medium transition',
              channel === v
                ? 'bg-navy text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            )}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Outbox List Card */}
      <Card pad={false}>
        {loading && !data ? (
          <Loading label="Loading outbox messages…" />
        ) : error && !data ? (
          <ErrorBox msg={error} />
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <Send size={20} />
            </div>
            <h3 className="text-sm font-semibold text-slate-800">No simulated messages found</h3>
            <p className="mt-1 text-xs text-slate-500">
              {channel
                ? `No ${channel.toUpperCase()} messages have been recorded yet.`
                : 'Reminders triggered automatically by the SLA engine or manually from the Alerts page will appear here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Subject / Summary</th>
                  <th className="px-4 py-3">Dispatched At</th>
                  <th className="px-4 py-3">Triggered By</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((m: any) => {
                  const isEmail = m.channel === 'email'
                  return (
                    <tr key={m.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-4 py-3">
                        <span
                          className={cx(
                            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
                            isEmail
                              ? 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20'
                              : 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20'
                          )}
                        >
                          {isEmail ? <Mail size={13} /> : <MessageSquare size={13} />}
                          {m.channel?.toUpperCase()}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">Bureau {m.recipient_bureau}</div>
                        <div className="text-xs text-slate-500">{m.recipient_role}</div>
                      </td>

                      <td className="max-w-[340px] px-4 py-3">
                        <div className="truncate font-medium text-slate-900" title={m.subject}>
                          {m.subject}
                        </div>
                        <div className="truncate text-xs text-slate-400" title={m.body}>
                          {m.body?.slice(0, 90)}…
                        </div>
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        <div>{ago(m.created_at)}</div>
                        <div className="text-[11px] text-slate-400">{fmtTs(m.created_at)}</div>
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <User size={12} className="text-slate-400" />
                          {m.created_by || 'System'}
                        </span>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {m.status || 'SIMULATED'}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedItem(m)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          <Eye size={12} className="text-slate-500" />
                          Details
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Message Detail Drawer */}
      <Drawer
        open={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        width={620}
        title={
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Notification Payload Details</h2>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                #{selectedItem?.id}
              </span>
            </div>
            <p className="text-xs text-slate-500">Record from simulated outbox table</p>
          </div>
        }
      >
        {selectedItem && (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800">
              <span className="font-semibold">Notice:</span> This transmission was recorded locally in the database. In a production deployment, this payload is consumed by an SMTP or SMS gateway implementation of the{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">Notifier</code> protocol.
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Channel</span>
                <span className="mt-0.5 font-bold uppercase text-slate-800">{selectedItem.channel}</span>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Status</span>
                <span className="mt-0.5 font-bold text-emerald-700">{selectedItem.status}</span>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Recipient Bureau</span>
                <span className="mt-0.5 font-bold text-slate-800">Bureau {selectedItem.recipient_bureau}</span>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Recipient Role</span>
                <span className="mt-0.5 font-bold text-slate-800">{selectedItem.recipient_role}</span>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Dispatched At</span>
                <span className="mt-0.5 font-medium text-slate-700">{fmtTs(selectedItem.created_at)}</span>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Initiated By</span>
                <span className="mt-0.5 font-medium text-slate-700">{selectedItem.created_by}</span>
              </div>
            </div>

            <div>
              <span className="mb-1 block text-xs font-semibold text-slate-700">Subject</span>
              <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs font-medium text-slate-900 shadow-sm">
                {selectedItem.subject}
              </div>
            </div>

            <div>
              <span className="mb-1 block text-xs font-semibold text-slate-700">Body Payload</span>
              <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-200 shadow-inner">
                {selectedItem.body}
              </pre>
            </div>

            {selectedItem.alert_id && (
              <div className="pt-2 text-right">
                <Link
                  to="/alerts"
                  className="inline-flex items-center gap-1 text-xs font-medium text-navy hover:underline"
                >
                  View associated Alert #{selectedItem.alert_id} <ArrowUpRight size={13} />
                </Link>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}
