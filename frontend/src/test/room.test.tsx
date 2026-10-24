import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setRole } from '../api'
import Room from '../pages/Room'
import { mockApi, renderPage } from './utils'

const room = {
  id: 'ROOM-0001', status: 'OPEN', decision: null, lead_bureau: 'RB',
  institution: { aicte_id: '1-4520311', name: 'Sahyadri College', region: 'Western' },
  cases: ['RB', 'PGRC'].map((bureau) => ({
    case_id: `${bureau}/2026/00001`, bureau, category: 'Faculty Deficiency',
    status: 'Under Process', assigned_officer: { name: `${bureau} officer` },
  })),
  comments: [], timeline: [],
  pairs: [{
    id: 'PR-0001', case_a: 'RB/2026/00001', case_b: 'PGRC/2026/00001',
    score: 88, band: 'HIGH', status: 'OPEN', breakdown: [], explanation: 'Shared faculty complaint',
  }],
}

describe('Coordination Room role regression', () => {
  it.each(['SENIOR', 'PGRC', 'REGIONAL', 'VIG'])('renders for %s without a declaration-order crash', async (role) => {
    setRole({ role, region: role === 'REGIONAL' ? 'Western' : '' })
    mockApi({ '/api/rooms/ROOM-0001': room })
    renderPage(<Room />, '/rooms/ROOM-0001', '/rooms/:id')
    expect(await screen.findByRole('heading', { name: /Coordination Room/ })).toBeInTheDocument()
    expect(screen.getByText('1 · Linked cases')).toBeInTheDocument()
    expect(screen.getByText('No comments yet — start the conversation.')).toBeInTheDocument()
  })
})
