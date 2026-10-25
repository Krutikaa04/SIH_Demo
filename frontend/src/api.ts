import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// ---- who is signed in -------------------------------------------------------------------------
// The browser holds only an HttpOnly session cookie (JavaScript cannot read it). Everything below asks the server.
export type RoleState = { role: string; region: string }
export type AuthUser = {
  id: number; username: string; display_name: string; role: string; role_label: string; region: string
  active: boolean; must_change_password: boolean; is_demo: boolean; last_login_at?: string
}
export type DemoAccount = { username: string; label: string; role: string; region: string; name: string }
export type AuthConfig = { demo_mode: boolean; demo_password?: string; demo_accounts?: DemoAccount[]; password_min: number; session_idle_hours: number }
type AuthState = { status: 'loading' | 'anon' | 'authed'; user: AuthUser | null; config: AuthConfig | null; notice: string }

const bus = new EventTarget()
let auth: AuthState = { status: 'loading', user: null, config: null, notice: '' }
function setAuth(next: Partial<AuthState>) {
  auth = { ...auth, ...next }
  bus.dispatchEvent(new CustomEvent('auth.changed'))
}
export const getAuth = () => auth
export const getRole = (): RoleState => ({ role: auth.user?.role || '', region: auth.user?.region || '' })
export function useAuth(): AuthState {
  const [s, setS] = useState(auth)
  useEffect(() => { setS(auth); return on('auth.changed', () => setS(auth)) }, [])
  return s
}
export function useRole(): RoleState {
  const a = useAuth()
  return useMemo(() => ({ role: a.user?.role || '', region: a.user?.region || '' }), [a.user?.role, a.user?.region])
}

export async function api(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch('/api' + path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  if (!r.ok) {
    const t = await r.text()
    let msg = t
    let detail: any = null
    try { detail = JSON.parse(t).detail; msg = typeof detail === 'string' ? detail : (detail?.message || t) } catch {}
    const err: any = new Error(msg || r.statusText)
    err.status = r.status
    err.detail = detail
    if (r.status === 401 && auth.status === 'authed' && !path.startsWith('/auth/')) endSession('Your session has ended. Please sign in again.')
    if (r.status === 403 && detail?.code === 'PASSWORD_CHANGE_REQUIRED') refreshMe()
    throw err
  }
  return r.json()
}
export const post = (path: string, body: any = {}) => api(path, { method: 'POST', body: JSON.stringify(body) })

export async function loadAuth() {
  let config: AuthConfig | null = null
  try { config = await api('/auth/config') } catch { /* the sign-in page still works without it */ }
  try {
    const r = await api('/auth/me')
    setAuth({ status: 'authed', user: r.user, config })
    startEvents()
  } catch { setAuth({ status: 'anon', user: null, config }) }
}
export async function refreshMe() {
  try { setAuth({ user: (await api('/auth/me')).user }) } catch { /* handled by the 401 path */ }
}
export async function signIn(username: string, password: string) {
  const r = await post('/auth/login', { username, password })
  stopEvents()
  setAuth({ status: 'authed', user: r.user, notice: '' })
  startEvents()
  bus.dispatchEvent(new CustomEvent('role.changed'))
  return r.user as AuthUser
}
export async function signOut() {
  try { await post('/auth/logout') } catch { /* already gone */ }
  endSession('')
}
export function endSession(notice: string) {
  stopEvents()
  setAuth({ status: 'anon', user: null, notice })
}
export async function changePassword(current_password: string, new_password: string) {
  await post('/auth/change-password', { current_password, new_password })
  await refreshMe()
}

// ---- server-sent events -> in-page event bus ---------------------------------------
const EVENTS = ['dashboard.invalidate', 'case.created', 'case.updated', 'overlap.detected', 'alert.created',
  'room.created', 'room.updated', 'sla.escalated', 'reset', 'clock.changed']
let source: EventSource | null = null
export function startEvents() {
  if (source) return
  const es = new EventSource('/api/events')
  source = es
  EVENTS.forEach((name) =>
    es.addEventListener(name, (e: any) => {
      let detail = {}
      try { detail = JSON.parse(e.data) } catch {}
      bus.dispatchEvent(new CustomEvent(name, { detail }))
    }))
}
export function stopEvents() {
  source?.close()
  source = null
}
export function on(name: string, fn: (d: any) => void) {
  const h = (e: any) => fn(e.detail)
  bus.addEventListener(name, h)
  return () => bus.removeEventListener(name, h)
}

const REFRESH = ['dashboard.invalidate', 'reset', 'room.updated', 'room.created', 'case.created', 'case.updated',
  'alert.created', 'clock.changed', 'role.changed']

/** Fetch + auto-refresh whenever the server pushes a change. Keeps old data while reloading. */
export function useApi<T = any>(path: string | null, live = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const load = useCallback(() => {
    if (!path) return
    const my = ++seq.current
    api(path).then((d) => { if (my === seq.current) { setData(d); setError(null); setLoading(false) } })
      .catch((e) => { if (my === seq.current) { setError(String(e.message || e)); setData(null); setLoading(false) } })
  }, [path])
  useEffect(() => { setLoading(true); load() }, [load])
  useEffect(() => {
    if (!live) return
    let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(load, 250) }
    const offs = REFRESH.map((n) => on(n, bump))
    return () => { clearTimeout(t); offs.forEach((o) => o()) }
  }, [load, live])
  return { data: data as T, error, loading, reload: load }
}

/** Download a file from the API (the session cookie rides along, which a plain link to a protected route would not guarantee). */
export async function download(path: string, filename: string) {
  const r = await fetch('/api' + path, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  const url = URL.createObjectURL(await r.blob())
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
