import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { CreateProjectForm } from '@/components/projects/CreateProjectForm'

describe('CreateProjectForm', () => {
  test('calls onSubmit with name and url when form is valid', async () => {
    const onSubmit = vi.fn()
    render(<CreateProjectForm onSubmit={onSubmit} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Project name'), 'ACME Store')
    await userEvent.type(screen.getByLabelText('URL'), 'https://acme.com')
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'ACME Store', url: 'https://acme.com' })
  })

  test('shows validation error when URL is not https', async () => {
    render(<CreateProjectForm onSubmit={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Project name'), 'Store')
    await userEvent.type(screen.getByLabelText('URL'), 'http://acme.com')
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(screen.getByText(/must be https/i)).toBeInTheDocument()
  })

  test('shows validation error when name is too short', async () => {
    render(<CreateProjectForm onSubmit={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Project name'), 'A')
    await userEvent.type(screen.getByLabelText('URL'), 'https://acme.com')
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(screen.getByText(/at least 2/i)).toBeInTheDocument()
  })

  test('calls onCancel when cancel is clicked', async () => {
    const onCancel = vi.fn()
    render(<CreateProjectForm onSubmit={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
