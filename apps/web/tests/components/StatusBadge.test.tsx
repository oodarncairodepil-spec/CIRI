import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { StatusBadge } from '@/components/common/StatusBadge'

describe('StatusBadge', () => {
  test.each([
    ['measured', 'green'],
    ['inferred', 'yellow'],
    ['unknown', 'red'],
    ['unavailable', 'red'],
    ['not_applicable', 'grey'],
  ] as const)('renders %s status with %s colour class', (status, colour) => {
    const { container } = render(<StatusBadge status={status} />)
    expect(container.firstChild).toHaveClass(colour)
    expect(screen.getByText(status.replace(/_/g, ' '))).toBeInTheDocument()
  })

  test('also accepts job statuses', () => {
    render(<StatusBadge status="completed" />)
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  test('renders "running" status with yellow class', () => {
    const { container } = render(<StatusBadge status="running" />)
    expect(container.firstChild).toHaveClass('yellow')
  })

  test('renders "failed" status with red class', () => {
    const { container } = render(<StatusBadge status="failed" />)
    expect(container.firstChild).toHaveClass('red')
  })
})
