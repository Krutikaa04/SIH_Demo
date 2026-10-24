import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import Cases from '../pages/Cases'
import { mockApi, renderPage } from './utils'

it('shows the filters understood from a natural-language search', async () => {
  const fetchMock = mockApi({
    '/api/meta': { bureaus: [], regions: [], categories: [], statuses: [] },
    '/api/cases': { items: [], total: 0, page: 1, page_size: 25 },
    '/api/search/nl': {
      understood: true,
      params: { status: 'Pending', bureau: 'RB', region: 'Western', age_gt: 30 },
      chips: ['Pending', 'RB', 'Western', 'Older than 30 days'].map((label) => ({ label })),
    },
  })
  renderPage(<Cases />)
  await userEvent.click(screen.getByRole('button', { name: 'pending RB cases in Western region older than 30 days' }))
  expect(await screen.findByText('I understood:')).toBeInTheDocument()
  for (const label of ['Pending', 'RB', 'Western', 'Older than 30 days']) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  }
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/search/nl?q='))).toBe(true)
})
