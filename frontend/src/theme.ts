import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'icmd.theme'

function stored(): Theme {
  try { const t = localStorage.getItem(KEY); if (t === 'dark' || t === 'light') return t } catch { /* private mode */ }
  return 'light'
}
let current: Theme = stored()

export function applyTheme(t: Theme) {
  current = t
  document.documentElement.dataset.theme = t
  try { localStorage.setItem(KEY, t) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('theme.changed'))
}
export const initTheme = () => applyTheme(stored())

export function useTheme(): [Theme, () => void] {
  const [t, setT] = useState<Theme>(current)
  useEffect(() => { const h = () => setT(current); window.addEventListener('theme.changed', h); return () => window.removeEventListener('theme.changed', h) }, [])
  return [t, () => applyTheme(current === 'dark' ? 'light' : 'dark')]
}
