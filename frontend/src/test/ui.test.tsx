import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Card, RiskBadge, ScoreRing, SlaChip } from '../ui'

it.each([
  [{ state: 'CLOSED' }, 'Closed'],
  [{ state: 'BREACHED', remaining_days: -3, elapsed_pct: 120 }, '3d overdue'],
  [{ state: 'NEARING', remaining_days: 2, elapsed_pct: 80 }, '2d left'],
])('renders the SLA state', (sla, label) => {
  render(<SlaChip sla={sla} />)
  expect(screen.getByText(label)).toBeInTheDocument()
})

it('renders institution risk and matching score', () => {
  render(<><RiskBadge score={72} band="HIGH" /><ScoreRing score={88} band="HIGH" /></>)
  expect(screen.getByText(/72/)).toBeInTheDocument()
  expect(screen.getByText('88%')).toBeInTheDocument()
})

it('renders a Card subtitle alongside its title and content', () => {
  render(<Card title="Investigator workload" subtitle="Estimated from selected assumptions">Chart</Card>)
  expect(screen.getByRole('heading', { name: 'Investigator workload' })).toBeInTheDocument()
  expect(screen.getByText('Estimated from selected assumptions')).toBeInTheDocument()
  expect(screen.getByText('Chart')).toBeInTheDocument()
})
