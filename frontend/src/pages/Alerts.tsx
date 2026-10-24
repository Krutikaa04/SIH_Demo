import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertOctagon, ArrowRight, BellRing, CheckCircle2, CheckCheck, Clock, GitMerge, Mail, MessageSquare, Repeat2, Send, ShieldCheck, TrendingUp } from 'lucide-react'
import { post, useApi, api, useRole } from '../api'
import { BureauBadge, Card, Drawer, EmptyState, ErrorBox, Loading, PageHeader, ago, cx } from '../ui'

const TABS = [
  ['', 'Everything'],
  ['OVERLAP', 'Overlaps'],
  ['ESCALATION', 'Escalations'],
  ['SLA_NEAR', 'Due soon'],
  ['SLA_BREACH', 'Past due date'],
  ['PENDING_REMINDER', 'Reminders'],
  ['PING_PONG', 'Passed around'],
]
const ICON: any = { OVERLAP: GitMerge, SLA_NEAR: Clock, SLA_BREACH: AlertOctagon, ESCALATION: TrendingUp, PENDING_REMINDER: BellRing, PING_PONG: Repeat2 }
const KIND: any = { OVERLAP: 'Overlap', SLA_NEAR: 'Due soon', SLA_BREACH: 'Past due date', ESCALATION: 'Escalated', PENDING_REMINDER: 'Reminder', PING_PONG: 'Passed around' }

const dayOf = (s: string) => {
  const d = Math.floor((Date.now() - new Date(s).getTime()) / 86400000)
  return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : 'Earlier'
}

export default function Alerts() {
  const me = useRole()
  const isRegional = me.role === 'REGIONAL'
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
    try { setPreview(await api(`/alerts/${alertId}/notify/preview?channel=${ch}`)) } catch { setPreview(null) } finally { setPreviewLoading(false) }
  }
  async function changeChannel(ch: 'email' | 'sms') {
    setChannel(ch)
    if (selectedAlert) await loadPreview(selectedAlert.id, ch)
  }
  async function handleSendReminder() {
    if (!selectedAlert) return
    setSending(true)
    setSendError(null)
    try { setSentSuccess(await post(`/alerts/${selectedAlert.id}/notify`, { channel })) }
    catch (err: any) { setSendError(err.message || 'The reminder could not be sent.') }
    finally { setSending(false) }
  }

  const groups: Record<string, any[]> = {}
  ;(data?.items || []).forEach((a: any) => { (groups[dayOf(a.created_at)] ||= []).push(a) })

  return (
    <div className="mx-auto max-w-[920px]">
      <PageHeader eyebrow="Alerts" title="What needs your attention"
        subtitle={data?.unread ? <>You have <b className="font-semibold text-slate-900">{data.unread} new</b>. Select an alert to open the case or overlap it is about.</> : 'You are all caught up. New alerts appear here and in the bell.'}
        actions={<>
          <Link to="/outbox" className="btn btn-ghost"><Send size={14} /> Sent messages</Link>
          <button onClick={async () => { await post('/alerts/read-all'); reload() }} className="btn btn-ghost"><CheckCheck size={15} /> Mark all as read</button>
        </>} />

      <div className="rise rise-1 mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Alert type">
        {TABS.map(([v, l]) => (
          <button key={v} role="tab" aria-selected={type === v} onClick={() => setType(v)}
            className={cx('rounded-full border px-3.5 py-1.5 text-sm font-semibold transition', type === v ? 'border-navy bg-navy text-white' : 'border-line bg-sheet text-slate-600 hover:border-slate-300 hover:text-slate-900')}>{l}</button>))}
      </div>

      {loading && !data ? <Loading /> : error && !data ? <ErrorBox msg={error} /> : data.items.length === 0 ? (
        <Card><EmptyState icon={CheckCircle2} title="No alerts here">Nothing needs your attention in this group.</EmptyState></Card>
      ) : (
        <div className="rise rise-2 space-y-6">
          {Object.entries(groups).map(([day, list]) => (
            <section key={day}>
              <h2 className="eyebrow mb-2 px-1">{day}</h2>
              <Card pad={false}>
                <ul className="divide-y divide-line">
                  {list.map((a: any) => {
                    const Icon = ICON[a.type] || Clock
                    return (
                      <li key={a.id} className="group flex items-center gap-2 pr-3 transition hover:bg-slate-50">
                        <Link to={a.link} onClick={() => post(`/alerts/${a.id}/read`)} className="flex min-w-0 flex-1 items-start gap-3.5 py-3.5 pl-4">
                          <span className={cx('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg', a.severity === 'HIGH' ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600', a.read && 'opacity-45')}><Icon size={17} /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              {!a.read && <span className="h-2 w-2 shrink-0 rounded-full bg-saffron" aria-label="New" />}
                              <span className="eyebrow !text-[10px]">{KIND[a.type] || 'Alert'}</span>
                              <span className="text-xs text-slate-400">{ago(a.created_at)}</span>
                            </span>
                            <span className={cx('mt-0.5 block text-[14.5px] leading-snug', a.read ? 'text-slate-500' : 'font-semibold text-slate-900')}>{a.message}</span>
                            <span className="mt-0.5 block truncate text-[13px] text-slate-500">{[a.institution_name, a.case_id].filter(Boolean).join(' · ')}</span>
                            {(a.target_bureaus || []).length > 0 && (
                              <span className="mt-1.5 flex flex-wrap items-center gap-1" title="Bureaus this alert is for">
                                {a.target_bureaus.map((b: string) => <BureauBadge key={b} code={b} />)}
                              </span>)}
                          </span>
                          <ArrowRight size={16} className="mt-3 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
                        </Link>
                        {!isRegional && (
                          <button type="button" onClick={() => openReminderDrawer(a)} title="Send a reminder about this to the Bureau concerned"
                            className="btn btn-ghost btn-sm shrink-0 opacity-70 group-hover:opacity-100"><Send size={12} /> Remind</button>)}
                      </li>)
                  })}
                </ul>
              </Card>
            </section>))}
        </div>)}

      <Drawer open={Boolean(selectedAlert)} onClose={() => setSelectedAlert(null)} width={580}
        title={<div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-[1.5rem] font-semibold text-slate-900">Send a reminder</h2>
            <span className="inline-flex items-center gap-1 rounded-[4px] border border-amber-200 bg-amber-50 px-1.5 py-px text-[10.5px] font-bold uppercase tracking-wider text-amber-700"><ShieldCheck size={11} /> Practice only</span>
          </div>
          <p className="mt-0.5 text-[13px] text-slate-500">See the message first, then record it in the sent-messages log.</p>
        </div>}>
        {selectedAlert && (
          <div className="space-y-5">
            <div className="rounded-lg border border-line bg-slate-100/60 p-3 text-[13px] leading-relaxed text-slate-600">
              <b className="text-slate-800">Nothing is actually sent.</b> In this prototype the message is only stored in the app’s own log. No real email or text message leaves the computer.
            </div>

            <div className="rounded-lg border border-line bg-white p-3.5">
              <div className="eyebrow">The alert</div>
              <div className="mt-1 text-[15px] font-semibold text-slate-900">{selectedAlert.message}</div>
              <div className="text-[13px] text-slate-500">{[selectedAlert.institution_name, selectedAlert.case_id].filter(Boolean).join(' · ')}</div>
            </div>

            <div>
              <span className="mb-1.5 block text-sm font-semibold">How should it be sent?</span>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Channel">
                {([['email', Mail, 'Email'], ['sms', MessageSquare, 'Text message']] as const).map(([k, I, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={channel === k} onClick={() => changeChannel(k)}
                    className={cx('flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-semibold transition', channel === k ? 'border-navy bg-navy/[.04] text-navy ring-2 ring-navy' : 'border-line bg-white text-slate-600 hover:border-slate-400')}>
                    <I size={15} /> {l}</button>))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm font-semibold"><span>The message</span>
                {preview && <span className="text-xs font-normal text-slate-400">To: {preview.recipient_bureau} ({preview.recipient_role})</span>}</div>
              {previewLoading ? <div className="rounded-lg border border-line bg-slate-100 p-6 text-center text-sm text-slate-400">Preparing the message…</div>
                : preview ? (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-line bg-white p-3 text-sm font-semibold text-slate-800"><span className="font-normal text-slate-400">Subject: </span>{preview.subject}</div>
                    <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-white p-3.5 font-sans text-[13.5px] leading-relaxed text-slate-700">{preview.body}</pre>
                  </div>)
                  : <div className="rounded-lg border border-line bg-slate-100 p-4 text-sm text-slate-400">The message could not be prepared.</div>}
            </div>

            {sendError && <ErrorBox msg={sendError} />}
            {sentSuccess && (
              <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                <div><div className="font-semibold">Recorded.</div><div className="text-emerald-800">Saved as message #{sentSuccess.id} in the sent-messages log.</div>
                  <Link to="/outbox" className="mt-1.5 inline-flex items-center gap-1 font-semibold underline">Open the log <ArrowRight size={12} /></Link></div>
              </div>)}

            <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
              <button type="button" onClick={() => setSelectedAlert(null)} className="btn btn-ghost">{sentSuccess ? 'Close' : 'Cancel'}</button>
              {!sentSuccess && <button type="button" onClick={handleSendReminder} disabled={sending || previewLoading} className="btn btn-primary"><Send size={14} />{sending ? 'Recording…' : 'Record this reminder'}</button>}
            </div>
          </div>)}
      </Drawer>
    </div>
  )
}
