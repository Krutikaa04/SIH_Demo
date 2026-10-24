import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import { ToastProvider } from '../toast'

export function renderPage(ui: ReactElement, entry = '/', path = '*') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Routes><Route path={path} element={ui} /></Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

export function mockApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    if (!(url.pathname in routes)) throw new Error(`Unexpected request: ${url.pathname}`)
    return new Response(JSON.stringify(routes[url.pathname]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
