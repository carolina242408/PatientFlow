import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

const PAGES = ['/dashboard', '/lhu', '/unit', '/service', '/admin', '/account', '/settings'] as const

const AppLayout = () => {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const page = PAGES.find((p) => pathname === p || pathname.startsWith(`${p}/`))?.slice(1) ?? 'default'

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white font-sans">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar pageName={t(`pages.${page}.title`)} pageDescription={t(`pages.${page}.description`)} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-[#fafafa] px-9 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default AppLayout
