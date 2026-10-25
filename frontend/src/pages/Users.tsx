import { FormEvent, useState } from 'react'
import { Check, Copy, KeyRound, Plus, ShieldOff, UserCheck, UserX } from 'lucide-react'
import { api, post, useApi, useAuth } from '../api'
import { BUREAU_COLORS, BUREAU_NAMES, Card, Drawer, EmptyState, ErrorBox, Loading, PageHeader, cx, fmtTs } from '../ui'

const ROLES = ['RB', 'PGRC', 'AB', 'LC', 'VIG', 'REGIONAL', 'SENIOR']
const EVENT: Record<string, string> = {
  login: 'Signed in', logout: 'Signed out', login_failed: 'Wrong password', login_blocked: 'Blocked', user_created: 'Account created',
  user_updated: 'Account changed', password_reset: 'Password reset', password_changed: 'Password changed', password_change_failed: 'Password change failed',
}
const BAD = new Set(['login_failed', 'login_blocked', 'password_change_failed'])

function Secret({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
      <div className="font-display text-[1.0625rem] font-semibold">{label}</div>
      <p className="mt-1 text-[13px]">Shown once. Give it to the person in person or by phone; they must choose their own password when they first sign in.</p>
      <div className="mt-2.5 flex items-center gap-2">
        <code className="flex-1 select-all rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-[15px] tracking-wide">{value}</code>
        <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(value); setCopied(true) }}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button>
      </div>
      <button onClick={onClose} className="mt-3 text-[12.5px] font-semibold underline">I have noted it</button>
    </div>
  )
}

function AddUser({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (u: any, temp: string) => void }) {
  const meta = useApi<any>('/meta', false)
  const [f, setF] = useState({ username: '', display_name: '', role: 'RB', region: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    try { const r = await post('/users', f); onCreated(r.user, r.temporary_password); setF({ username: '', display_name: '', role: 'RB', region: '' }); onClose() }
    catch (ex: any) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <Drawer open={open} onClose={onClose} width={460} title={<div><div className="eyebrow">New account</div><div className="font-display text-[1.5rem] font-semibold">Add a person</div></div>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">Full name</span>
          <input className="field" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} placeholder="e.g. R. Sharma" /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">Username</span>
          <input className="field" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" spellCheck={false} placeholder="e.g. r.sharma" />
          <span className="mt-1 block text-[12px] text-slate-500">Letters, numbers, dots and dashes. They will type this to sign in.</span></label>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">Role</span>
          <select className="field" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{BUREAU_NAMES[r]}</option>)}</select></label>
        {f.role === 'REGIONAL' && (
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">Region</span>
            <select className="field" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}>
              <option value="">Choose a region…</option>{(meta.data?.regions || []).map((r: any) => <option key={r.name}>{r.name}</option>)}</select></label>)}
        <p className="rounded-lg bg-slate-100 p-3 text-[13px] leading-relaxed text-slate-600">A temporary password is created for you to hand over. The person must replace it the first time they sign in.</p>
        {err && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{err}</div>}
        <button className="btn btn-primary w-full !py-3" disabled={busy || !f.username.trim() || !f.display_name.trim() || (f.role === 'REGIONAL' && !f.region)}>{busy ? 'Creating…' : 'Create the account'}</button>
      </form>
    </Drawer>
  )
}

export default function Users() {
  const me = useAuth().user
  const allowed = me?.role === 'SENIOR'
  const { data, error, loading, reload } = useApi<any>(allowed ? '/users' : null)
  const ev = useApi<any>(allowed ? '/auth/events?limit=30' : null)
  const [adding, setAdding] = useState(false)
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null)
  const [err, setErr] = useState('')
  const act = async (fn: () => Promise<any>) => { setErr(''); try { await fn(); reload(); ev.reload() } catch (e: any) { setErr(e.message) } }

  if (!allowed) return <div className="mx-auto max-w-[640px]"><Card><EmptyState icon={ShieldOff} title="This page is for Senior Management">Accounts and sign-in activity are managed by Senior Management. If you need access for someone, ask them.</EmptyState></Card></div>

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader eyebrow="More" title="People and access" subtitle="Who can sign in, what they can do, and what has happened lately. Only Senior Management sees this page."
        actions={<button onClick={() => setAdding(true)} className="btn btn-primary"><Plus size={16} /> Add a person</button>} />
      {secret && <div className="mb-5"><Secret label={secret.label} value={secret.value} onClose={() => setSecret(null)} /></div>}
      {err && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{err}</div>}

      <Card pad={false} className="overflow-hidden">
        {loading && !data ? <div className="p-5"><Loading /></div> : error && !data ? <ErrorBox msg={error} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100/60 text-left"><tr>{['Person', 'Role', 'Last signed in', 'Status', ''].map((h, i) => <th key={i} className={cx('eyebrow px-4 py-2.5', i === 0 && 'px-5')}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {data.items.map((u: any) => (
                  <tr key={u.id} className={cx(!u.active && 'opacity-60')}>
                    <td className="px-5 py-3"><div className="flex items-center gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold text-white" style={{ background: BUREAU_COLORS[u.role] }}>{u.role === 'SENIOR' ? 'SM' : u.role === 'REGIONAL' ? 'RO' : u.role.slice(0, 2)}</span>
                      <span><span className="block font-medium text-slate-900">{u.display_name}{u.id === me?.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}</span><span className="font-mono text-[12px] text-slate-500">{u.username}</span></span></div></td>
                    <td className="px-4 py-3 text-slate-700">{BUREAU_NAMES[u.role]}{u.region && <span className="text-slate-400"> · {u.region}</span>}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-500">{u.last_login_at ? fmtTs(u.last_login_at) : 'Never'}</td>
                    <td className="px-4 py-3">
                      {!u.active ? <span className="rounded-[4px] border border-slate-300 bg-slate-100 px-1.5 py-px text-[11px] font-bold uppercase tracking-wider text-slate-600">Disabled</span>
                        : u.locked ? <span className="rounded-[4px] border border-amber-300 bg-amber-50 px-1.5 py-px text-[11px] font-bold uppercase tracking-wider text-amber-800">Locked</span>
                          : u.must_change_password ? <span className="rounded-[4px] border border-amber-200 bg-amber-50 px-1.5 py-px text-[11px] font-bold uppercase tracking-wider text-amber-800">Temporary password</span>
                            : <span className="rounded-[4px] border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[11px] font-bold uppercase tracking-wider text-emerald-700">Active</span>}
                      {u.is_demo && <span className="ml-1.5 text-[11px] text-slate-400">demo</span>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button className="btn btn-ghost btn-sm" title="Create a new temporary password and sign them out"
                        onClick={() => act(async () => { if (window.confirm(`Reset the password for ${u.display_name}? They will be signed out.`)) { const r = await post(`/users/${u.id}/reset-password`); setSecret({ label: `New temporary password for ${u.display_name}`, value: r.temporary_password }) } })}><KeyRound size={13} /> Reset</button>
                      {u.id !== me?.id && (u.active
                        ? <button className="btn btn-ghost btn-sm ml-1.5" onClick={() => act(async () => { if (window.confirm(`Disable ${u.display_name}? They will be signed out and cannot sign in.`)) await api(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: false }) }) })}><UserX size={13} /> Disable</button>
                        : <button className="btn btn-ghost btn-sm ml-1.5" onClick={() => act(() => api(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: true }) }))}><UserCheck size={13} /> Enable</button>)}
                    </td>
                  </tr>))}
              </tbody>
            </table>
          </div>)}
      </Card>

      <Card className="mt-6" title="Recent sign-in activity" subtitle="Newest first. Repeated wrong passwords are worth a look.">
        {(ev.data?.items || []).length === 0 ? <EmptyState icon={ShieldOff} title="Nothing yet" /> : (
          <ul className="divide-y divide-line">
            {ev.data.items.map((e: any, i: number) => (
              <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                <span className={cx('w-40 shrink-0 font-semibold', BAD.has(e.event) ? 'text-red-700' : 'text-slate-800')}>{EVENT[e.event] || e.event}</span>
                <span className="font-mono text-[12.5px] text-slate-600">{e.username}</span>
                <span className="flex-1 truncate text-[13px] text-slate-500">{e.detail}</span>
                <span className="text-[12px] text-slate-400">{fmtTs(e.ts)}{e.ip ? ` · ${e.ip}` : ''}</span>
              </li>))}
          </ul>)}
      </Card>

      <AddUser open={adding} onClose={() => setAdding(false)} onCreated={(u, temp) => { setSecret({ label: `Temporary password for ${u.display_name}`, value: temp }); reload(); ev.reload() }} />
    </div>
  )
}
