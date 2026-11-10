import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { GapReportTable } from '@/components/gap-report/GapReportTable'
import type { PlugoMapping } from '@/api/types'

const mappings: PlugoMapping[] = [
  { componentType: 'product-grid', plugoEndpoint: 'GET /products', renderHint: 'Paginate...', isGap: false },
  { componentType: 'customer-login', isGap: true, gapReason: 'No auth API in Plugo v1', renderHint: '' },
]

describe('GapReportTable', () => {
  test('renders a row per mapping plus header', () => {
    render(<GapReportTable mappings={mappings} />)
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  test('marks gap rows with "Gap" badge', () => {
    render(<GapReportTable mappings={mappings} />)
    expect(screen.getByText('Gap')).toBeInTheDocument()
  })

  test('marks available rows with "Available" badge', () => {
    render(<GapReportTable mappings={mappings} />)
    expect(screen.getByText('Available')).toBeInTheDocument()
  })

  test('shows gap reason for gap components', () => {
    render(<GapReportTable mappings={mappings} />)
    expect(screen.getByText('No auth API in Plugo v1')).toBeInTheDocument()
  })

  test('gaps appear before available components', () => {
    render(<GapReportTable mappings={mappings} />)
    const rows = screen.getAllByRole('row').slice(1) // skip header
    expect(rows[0]).toHaveTextContent('customer-login')
    expect(rows[1]).toHaveTextContent('product-grid')
  })
})
