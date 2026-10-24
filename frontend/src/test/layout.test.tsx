import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { setRole } from '../api'
import Layout from '../Layout'
import { mockApi, renderPage } from './utils'

function setup(enabled: boolean, role: string) {
  setRole({ role, region: role === 'REGIONAL' ? 'Western' : '' })
  mockApi({
    '/api/meta': { demo_mode: enabled, roles: [{ code: role, label: role }], regions: [] },
    '/api/overlaps': { items: [] }, '/api/alerts': { items: [], unread: 0 },
    '/api/clock': { offset_days: 0 },
  })
  renderPage(<Layout />)
}

it.each([[false, 'SENIOR'], [true, 'RB'], [true, 'PGRC'], [true, 'REGIONAL']])(
  'hides mutations for demo_mode=%s role=%s, including the keyboard shortcut', async (enabled: boolean, role: string) => {
    setup(enabled, role)
    expect(await screen.findByRole('button', { name: 'Verify audit trail' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Demo$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Simulate/ })).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true })
    expect(screen.queryByText('Reset demo data')).not.toBeInTheDocument()
  },
)

it('shows demo controls for an enabled Senior session', async () => {
  setup(true, 'SENIOR')
  await userEvent.click(await screen.findByRole('button', { name: /^Demo$/ }))
  expect(screen.getByRole('button', { name: 'Reset demo data' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Tamper with a record' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Time machine: +7 days' })).toBeInTheDocument()
})
