import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import { startEvents } from './api'
import { ToastProvider } from './toast'
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

startEvents()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="cases" element={<Cases />} />
            <Route path="cases/*" element={<CaseDetail />} />
            <Route path="overlaps" element={<Overlaps />} />
            <Route path="rooms/:id" element={<Room />} />
            <Route path="institutions" element={<Institutions />} />
            <Route path="institutions/:id" element={<Institution />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="reports" element={<Reports />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
