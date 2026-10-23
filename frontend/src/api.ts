import { useCallback, useEffect, useRef, useState } from 'react'

// ---- acting role (prototype: no login; the API enforces the permission matrix from these headers) ----
export type RoleState = { role: string; region: string }
const KEY = 'icmd.role'
const bus = new EventTarget()
function loadRole(): RoleState {
  try { const v = JSON.parse(localStorage.getItem(KEY) || ''); if (v?.role) return v } catch {}
  return { role: 'SENIOR', region: '' }
}
let current: RoleState = loadRole()
export const getRole = () => current
export function setRole(r: RoleState) {
  current = r
  try { localStorage.setItem(KEY, JSON.stringify(r)) } catch {}
  bus.dispatchEvent(new CustomEvent('role.changed'))
}
export function useRole(): RoleState {
  const [r, setR] = useState(current)
  useEffect(() => on('role.changed', () => setR({ ...current })), [])
  return r
}

export async function api(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json', 'X-Role': current.role, 'X-Region': current.region }, ...init,
  })
  if (!r.ok) {
    const t = await r.text()
    let msg = t
    try { msg = JSON.parse(t).detail || t } catch {}
    throw new Error(msg || r.statusText)
  }
  return r.json()
}
export const post = (path: string, body: any = {}) => api(path, { method: 'POST', body: JSON.stringify(body) })

// ---- server-sent events -> in-page event bus ---------------------------------------
const EVENTS = ['dashboard.invalidate', 'case.created', 'case.updated', 'overlap.detected', 'alert.created',
  'room.created', 'room.updated', 'sla.escalated', 'reset', 'clock.changed']
let started = false
export function startEvents() {
  if (started) return
  started = true
  const es = new EventSource('/api/events')
  EVENTS.forEach((name) =>
    es.addEventListener(name, (e: any) => {
      let detail = {}
      try { detail = JSON.parse(e.data) } catch {}
      bus.dispatchEvent(new CustomEvent(name, { detail }))
    }))
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

/** Download a file from the API (sends the acting-role headers, which a plain link cannot). */
export async function download(path: string, filename: string) {
  const r = await fetch('/api' + path, { headers: { 'X-Role': current.role, 'X-Region': current.region } })
  if (!r.ok) throw new Error(await r.text())
  const url = URL.createObjectURL(await r.blob())
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
