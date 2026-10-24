import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertOctagon,
  BellRing,
  Clock,
  GitMerge,
  Repeat2,
  TrendingUp,
  Send,
  Mail,
  MessageSquare,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react'
import { post, useApi, api } from '../api'
import { Card, Drawer, ErrorBox, Loading, ago, cx } from '../ui'

const TABS = [
  ['', 'All'],
  ['OVERLAP', 'Overlap'],
  ['ESCALATION', 'Escalations'],
  ['SLA_NEAR', 'Nearing timeline'],
  ['SLA_BREACH', 'Timeline breached'],
  ['PENDING_REMINDER', 'Reminders'],
  ['PING_PONG', 'Ping-pong'],
]
const ICON: any = {
  OVERLAP: GitMerge,
  SLA_NEAR: Clock,
  SLA_BREACH: AlertOctagon,
  ESCALATION: TrendingUp,
  PENDING_REMINDER: BellRing,
  PING_PONG: Repeat2,
}

export default function Alerts() {
  const [type, setType] = useState('')
  const [selectedAlert, setSelectedAlert] = useState<any>(null)
  const [channel, setChannel] = useState<'email' | 'sms'>('email')
  const [preview, setPreview] = useState<any>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [sentSuccess, setSentSuccess] = useState<any>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  const { data, error, loading, reload } = useApi<any>('/alerts?limit=200' + (type ? `&type=${type}` : ''))

  async function openReminderDrawer(alert: any) {
    setSelectedAlert(alert)
    setChannel('email')
    setSentSuccess(null)
    setSendError(null)
    await loadPreview(alert.id, 'email')
  }

  async function loadPreview(alertId: number, ch: string) {
    setPreviewLoading(true)
    try {
      const res = await api(`/alerts/${alertId}/notify/preview?channel=${ch}`)
      setPreview(res)
    } catch (err: any) {
      setPreview(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  async function changeChannel(ch: 'email' | 'sms') {
    setChannel(ch)
    if (selectedAlert) {
      await loadPreview(selectedAlert.id, ch)
    }
  }

  async function handleSendReminder() {
    if (!selectedAlert) return
    setSending(true)
    setSendError(null)
    try {
      const res = await post(`/alerts/${selectedAlert.id}/notify`, { channel })
      setSentSuccess(res)
    } catch (err: any) {
      setSendError(err.message || 'Failed to dispatch simulated reminder.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Alerts &amp; notifications</h1>
          <p className="text-sm text-slate-500">Overlap alerts, timeline warnings, and dispatch reminders across Bureaus.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/outbox"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm inline-flex items-center gap-1.5"
          >
            <Send size={13} className="text-navy" /> View Outbox
          </Link>
          <button
            onClick={async () => {
              await post('/alerts/read-all')
              reload()
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 shadow-sm"
          >
            Mark all read
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(([v, l]) => (
          <button
            key={v}
            onClick={() => setType(v)}
            className={cx(
              'rounded-full px-3.5 py-1.5 text-sm font-medium transition',
              type === v ? 'bg-navy text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            )}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Alert list card */}
      <Card pad={false}>
        {loading && !data ? (
          <Loading />
        ) : error && !data ? (
          <ErrorBox msg={error} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((a: any) => {
              const Icon = ICON[a.type] || Clock
              const to = a.link
              return (
                <li key={a.id} className="group flex items-center justify-between hover:bg-slate-50/80 transition px-4 py-3.5">
                  <Link
                    to={to}
                    onClick={() => post(`/alerts/${a.id}/read`)}
                    className="flex items-start gap-3.5 min-w-0 flex-1"
                  >
                    <span
                      className={cx(
                        'mt-0.5 rounded-lg p-2 shrink-0',
                        a.severity === 'HIGH' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600',
                        a.read && 'opacity-50'
                      )}
                    >
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block text-sm', a.read ? 'text-slate-500' : 'font-semibold text-slate-900')}>
                        {a.message}
                      </span>
                      <span className="block truncate text-xs text-slate-500 mt-0.5">
                        {[a.institution_name, a.case_id].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400 mr-2">{ago(a.created_at)}</span>
                  </Link>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      openReminderDrawer(a)
                    }}
                    className="ml-2 shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:text-navy hover:border-slate-300 transition"
                    title="Send simulated reminder"
                  >
                    <Send size={12} className="text-navy" />
                    Send reminder
                  </button>
                </li>
              )
            })}
            {data.items.length === 0 && <li className="p-10 text-center text-slate-400">No alerts found.</li>}
          </ul>
        )}
      </Card>

      {/* Reminder Dispatch Drawer */}
      <Drawer
        open={Boolean(selectedAlert)}
        onClose={() => setSelectedAlert(null)}
        width={580}
        title={
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Send Simulated Reminder</h2>
              <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                <ShieldCheck size={11} /> SIMULATED
              </span>
            </div>
            <p className="text-xs text-slate-500">Preview and record notification into the local simulated outbox</p>
          </div>
        }
      >
        {selectedAlert && (
          <div className="space-y-4">
            {/* Notice banner */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">Demonstration notice:</span> Dispatches are stored in the
              local SQLite database (<code className="font-mono text-slate-700">outbox</code> table). No live emails or SMS
              messages are sent over the network.
            </div>

            {/* Alert context */}
            <div className="rounded-lg border border-slate-100 bg-white p-3 shadow-xs space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Selected Alert</div>
              <div className="text-sm font-semibold text-slate-800">{selectedAlert.message}</div>
              <div className="text-xs text-slate-500">
                {[selectedAlert.institution_name, selectedAlert.case_id].filter(Boolean).join(' · ')}
              </div>
            </div>

            {/* Channel Selection */}
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">Notification Channel</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => changeChannel('email')}
                  className={cx(
                    'flex items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-semibold transition',
                    channel === 'email'
                      ? 'border-navy bg-navy/5 text-navy ring-1 ring-navy'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <Mail size={14} /> Email Notice
                </button>
                <button
                  type="button"
                  onClick={() => changeChannel('sms')}
                  className={cx(
                    'flex items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-semibold transition',
                    channel === 'sms'
                      ? 'border-navy bg-navy/5 text-navy ring-1 ring-navy'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <MessageSquare size={14} /> SMS Alert
                </button>
              </div>
            </div>

            {/* Rendered Preview */}
            <div>
              <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Rendered Payload Preview</span>
                {preview && (
                  <span className="text-[11px] text-slate-400">
                    To: Bureau {preview.recipient_bureau} ({preview.recipient_role})
                  </span>
                )}
              </div>

              {previewLoading ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400">
                  Rendering template preview…
                </div>
              ) : preview ? (
                <div className="space-y-2">
                  <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs font-semibold text-slate-800 shadow-xs">
                    <span className="text-slate-400 font-normal">Subject: </span>
                    {preview.subject}
                  </div>
                  <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-200 shadow-inner">
                    {preview.body}
                  </pre>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-400">
                  Could not load preview.
                </div>
              )}
            </div>

            {/* Error or Success feedback */}
            {sendError && <ErrorBox msg={sendError} />}

            {sentSuccess && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-start gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold">Simulated reminder recorded successfully!</div>
                  <div className="mt-0.5 text-emerald-700">
                    Dispatched record #{sentSuccess.id} to Simulated Outbox.
                  </div>
                  <div className="mt-2">
                    <Link
                      to="/outbox"
                      className="inline-flex items-center gap-1 font-semibold text-emerald-900 underline hover:no-underline"
                    >
                      View in Outbox <ArrowRight size={12} />
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedAlert(null)}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                {sentSuccess ? 'Close' : 'Cancel'}
              </button>
              {!sentSuccess && (
                <button
                  type="button"
                  onClick={handleSendReminder}
                  disabled={sending || previewLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-navy-dark disabled:opacity-50 transition"
                >
                  <Send size={13} />
                  {sending ? 'Dispatching…' : 'Confirm & Dispatch Simulated Reminder'}
                </button>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
