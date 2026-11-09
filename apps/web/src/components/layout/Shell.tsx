import { NavLink, Outlet, useParams } from 'react-router-dom'

function navClass({ isActive }: { isActive: boolean }) {
  return `block px-3 py-2 rounded-md text-sm ${
    isActive ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'
  }`
}

export function Shell() {
  const { id } = useParams<{ id?: string }>()

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-white px-3 py-4">
        <div className="mb-6 px-3">
          <span className="text-lg font-bold text-indigo-700">Plugo Cloner</span>
        </div>
        <nav className="space-y-1">
          <NavLink to="/" className={navClass} end>
            All Projects
          </NavLink>
          {id && (
            <>
              <NavLink to={`/projects/${id}`} className={navClass} end>
                Dashboard
              </NavLink>
              <NavLink to={`/projects/${id}/pages`} className={navClass}>
                Pages
              </NavLink>
              <NavLink to={`/projects/${id}/gap-report`} className={navClass}>
                Gap Report
              </NavLink>
              <NavLink to={`/projects/${id}/export`} className={navClass}>
                Export
              </NavLink>
            </>
          )}
        </nav>
      </aside>
      <main className="flex-1 px-8 py-6">
        <Outlet />
      </main>
    </div>
  )
}
