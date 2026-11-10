import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { ProjectCard } from '@/components/projects/ProjectCard'
import { CreateProjectForm } from '@/components/projects/CreateProjectForm'
import { Spinner } from '@/components/common/Spinner'
import { EmptyState } from '@/components/common/EmptyState'
import { useProjects, useCreateProject } from '@/hooks/useProject'

export function ProjectsPage() {
  const [showForm, setShowForm] = useState(false)
  const navigate = useNavigate()
  const { data: projects, isLoading, error } = useProjects()
  const createProject = useCreateProject({
    onSuccess: (p) => {
      setShowForm(false)
      navigate(`/projects/${p.id}`)
    },
  })

  return (
    <div>
      <PageHeader
        title="Projects"
        actions={
          <button
            onClick={() => setShowForm(true)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + New project
          </button>
        }
      />

      {showForm && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 max-w-md">
          <h2 className="text-base font-semibold mb-4">New project</h2>
          <CreateProjectForm
            onSubmit={(data) => createProject.mutate(data)}
            onCancel={() => setShowForm(false)}
            isLoading={createProject.isPending}
            error={createProject.error?.message}
          />
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {error && (
        <p className="text-red-600 text-sm">{(error as Error).message}</p>
      )}

      {projects && projects.length === 0 && !showForm && (
        <EmptyState
          title="No projects yet"
          description="Create your first project to start migrating a website."
          action={{ label: 'Create your first project', onClick: () => setShowForm(true) }}
        />
      )}

      {projects && projects.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  )
}
