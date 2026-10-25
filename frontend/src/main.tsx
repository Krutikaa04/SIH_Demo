import { Fragment, StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import { loadAuth, useAuth } from './api'
import { ToastProvider } from './toast'
import { initTheme } from './theme'
import Layout from './Layout'
import Dashboard from './pages/Dashboard'
import Cases from './pages/Cases'
import CaseDetail from './pages/CaseDetail'
import Overlaps from './pages/Overlaps'
import Room from './pages/Room'
import Institutions from './pages/Institutions'
import Institution from './pages/Institution'
import Alerts from './pages/Alerts'
import Reports from './pages/Reports'
import Register from './pages/Register'
import Galaxy from './pages/Galaxy'
import AuditVault from './pages/AuditVault'
import Outbox from './pages/Outbox'
import Login from './pages/Login'
import Users from './pages/Users'
import ForcePasswordChange from './components/ChangePassword'
import Unmatched from './pages/Unmatched'


initTheme()

function Splash() {
  return <div className="grid min-h-screen place-items-center text-sm text-slate-400" role="status">Loading…</div>
}

/** Nothing of the app renders until the server confirms a signed-in session. */
function AuthGate() {
  const a = useAuth()
  useEffect(() => { loadAuth() }, [])
  if (a.status === 'loading') return <Splash />
  if (a.status === 'anon' || !a.user) return <Login />
  if (a.user.must_change_password) return <ForcePasswordChange name={a.user.display_name} />
  return (
    <Fragment key={a.user.id}>
      <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="cases" element={<Cases />} />
            <Route path="cases/*" element={<CaseDetail />} />
            <Route path="overlaps" element={<Overlaps />} />
            <Route path="rooms/:id" element={<Room />} />
            <Route path="galaxy" element={<Galaxy />} />
            <Route path="institutions" element={<Institutions />} />
            <Route path="institutions/:id" element={<Institution />} />
            <Route path="briefings" element={<Briefings />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="reports" element={<Reports />} />
            <Route path="register" element={<Register />} />
            <Route path="audit" element={<AuditVault />} />
            <Route path="outbox" element={<Outbox />} />
            <Route path="unmatched" element={<Unmatched />} />
            <Route path="users" element={<Users />} />
          </Route>
      </Routes>
    </Fragment>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthGate />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
