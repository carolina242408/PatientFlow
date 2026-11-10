import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router'
import { useKeycloak } from '../auth/context'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

const PAGES = ['/dashboard', '/hierarchy', '/admin', '/account', '/settings', '/lhu-hierarchy'] as const

const AppLayout = () => {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const { user } = useKeycloak()
  const page = PAGES.find((p) => pathname === p || pathname.startsWith(`${p}/`))?.slice(1) ?? 'default'
  const isManagerHierarchy = page === 'hierarchy' && user?.roles.includes('MANAGER')
  const hierarchyScope = user?.scopeType ?? 'unassigned'
  const pageName = isManagerHierarchy
    ? t(`pages.hierarchy.scopes.${hierarchyScope}.title`)
    : t(`pages.${page}.title`)
  const pageDescription = isManagerHierarchy
    ? t(`pages.hierarchy.scopes.${hierarchyScope}.description`)
    : t(`pages.${page}.description`)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white font-sans">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar pageName={pageName} pageDescription={pageDescription} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-[#fafafa] px-9 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default AppLayout
