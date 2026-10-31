import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import { useKeycloak } from '../auth/context'

import logoIcon from '/assets/app-logo.png'

import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  Settings,
  CircleUser,
  House,
  ChevronRight,
  ChevronLeft,
  LogOut,
  Info,
  Network
} from 'lucide-react'

interface SidebarItem {
  labelKey: string
  path?: string
  icon: LucideIcon
}

const getManagementSidebarItems = (roles: string[] = []): SidebarItem[] => {
  if (roles.includes('ROLE_ADMIN')) {
    return [{ labelKey: 'nav.lhuHierarchy', path: '/lhu-hierarchy', icon: Network }]
  }
  if (roles.includes('LHU_MANAGER')) {
    return [{ labelKey: 'nav.lhu', path: '/lhu', icon: House }]
  }
  if (roles.includes('UNIT_MANAGER')) {
    return [{ labelKey: 'nav.unit', path: '/unit', icon: House }]
  }
  if (roles.includes('SERVICE_MANAGER')) {
    return [{ labelKey: 'nav.service', path: '/service', icon: House }]
  }
  return []
}

const getWorkspaceLabel = (roles: string[] = []): string => {
  if (roles.includes('ROLE_ADMIN')) return 'nav.workspace.admin'
  else return 'nav.workspace.manager'
}



const Sidebar = () => {
  const { keycloak, user } = useKeycloak()
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false)
  const logoutDialogRef = useRef<HTMLDialogElement>(null)
  const managementItems = getManagementSidebarItems(user?.roles)
  const workspaceLabelKey = getWorkspaceLabel(user?.roles)
  const userRoles = user?.roles ?? []

  useEffect(() => {
    const dialog = logoutDialogRef.current
    if (logoutConfirmationOpen && dialog && !dialog.open) dialog.showModal()
  }, [logoutConfirmationOpen])

  const sections : Record<string, SidebarItem[]> = {
    Menu: [
      { labelKey: 'nav.dashboard', path: '/dashboard', icon: LayoutDashboard},
      ...managementItems,
    ],
    Settings: [
      { labelKey: 'nav.settings', path: '/settings', icon: Settings },
      { labelKey: 'nav.account', path: '/account', icon: CircleUser },
    ],
  }

  return (
    <aside
      className={`relative flex h-screen shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-[230px]'}`}
    >
      <div className={`flex h-[73px] items-center border-b border-gray-200 py-4 ${collapsed ? 'justify-center px-1.5' : 'gap-3 px-4'}`}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
          <img src={logoIcon} alt="Logo" className="h-6 w-6 object-contain brightness-0 invert" />
        </div>
        {!collapsed && (
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-[14px] font-semibold text-slate-900 leading-tight">
              {t(workspaceLabelKey)}
            </span>
            <span className="truncate text-[12px] font-normal text-slate-400">
              Ver o que colocar aqui
            </span>
          </div>
        )}
        
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="absolute -right-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-slate-400 shadow-sm hover:bg-gray-50 hover:text-slate-600 z-10"
          title={t(collapsed ? 'nav.expand' : 'nav.collapse')}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Main Menu */}
      <nav className={`flex-1 overflow-y-auto overflow-x-hidden py-5 ${collapsed ? 'px-2' : 'px-3'}`}>
        {Object.entries(sections).map(([section, items]) => {
          const filteredItems = items.filter((item) => {
            const isAdmin = userRoles.includes('ROLE_ADMIN')
            if (isAdmin && item.path === '/dashboard') {
              return false
            }
            return true
          })

          if (filteredItems.length === 0) return null

          return(
            <div key={section} className="mb-6">
              {!collapsed && (<div className="mb-2 pl-3 text-[12px] font-medium text-slate-400"> {section} </div>)}
              {filteredItems.map(({ icon: Icon, ...item }) => (
                <NavLink
                  key={item.path}
                  to={item.path!}
                  className={({ isActive }) =>
                    `mb-1 flex items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-[14px] font-medium transition-colors ${collapsed ? 'justify-center px-0' : 'gap-3.5 px-3.5'} ${
                      isActive
                        ? 'bg-blue-50 text-blue-600 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`
                  }
                  title={collapsed ? t(item.labelKey) : undefined}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {!collapsed && (
                    <span className="overflow-hidden text-ellipsis">
                      {t(item.labelKey)}
                    </span>
                  )}
                </NavLink>
              ))}
          </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className={`border-t border-gray-100 py-4 ${collapsed ? 'px-2' : 'px-3'}`}>
        {/* Logout Button */}
        <button
          type="button"
          onClick={() => setLogoutConfirmationOpen(true)}
          className={`mb-1 flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-[14px] font-semibold text-red-600 transition-colors hover:bg-red-50 ${
            collapsed ? 'justify-center px-0' : ''
          }`}
          title={collapsed ? t('nav.logout') : undefined}
        >
          <LogOut className="h-4 w-4 shrink-0 object-contain sidebar-icon-danger" />
          {!collapsed && (
            <span className="overflow-hidden whitespace-nowrap text-ellipsis">
              {t('nav.logout')}
            </span>
          )}
        </button>

        {/* Help Center Link */}
        <NavLink
          to="/help"
          className={({ isActive }) =>
            `flex items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-[14px] font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 ${
              collapsed ? 'justify-center px-0' : ''
            } ${isActive ? 'bg-blue-50 text-blue-600 font-semibold' : ''}`
          }
          title={collapsed ? t('nav.help') : undefined}
        >
          <Info className="h-4 w-4 shrink-0 object-contain opacity-70" />
          {!collapsed && (
            <span className="overflow-hidden whitespace-nowrap text-ellipsis">
              {t('nav.help')}
            </span>
          )}
        </NavLink>
      </div>
      <dialog
        ref={logoutDialogRef}
        aria-labelledby="logout-confirmation-title"
        aria-describedby="logout-confirmation-description"
        onClose={() => setLogoutConfirmationOpen(false)}
        className="logout-confirmation-dialog w-[calc(100%-2rem)] max-w-[500px] rounded-2xl border-0 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
      >
        <div className="p-8 sm:p-10">
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 text-red-600">
            <LogOut aria-hidden="true" className="h-9 w-9" />
          </div>
          <h2
            id="logout-confirmation-title"
            className="text-center text-2xl font-bold text-slate-900"
          >
            {t('nav.logoutConfirmation.title')}
          </h2>
          <p
            id="logout-confirmation-description"
            className="mt-3 text-center text-base text-slate-500"
          >
            {t('nav.logoutConfirmation.description')}
          </p>
          <div className="mt-8 flex flex-col gap-3 border-t border-gray-200 pt-7 sm:flex-row">
            <button
              type="button"
              onClick={() => logoutDialogRef.current?.close()}
              className="h-14 flex-1 rounded-xl border border-gray-200 bg-gray-100 px-5 text-base font-semibold text-slate-700 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {t('nav.logoutConfirmation.cancel')}
            </button>
            <button
              type="button"
              onClick={() => keycloak.logout()}
              className="h-14 flex-1 rounded-xl bg-red-500 px-5 text-base font-semibold text-white shadow-md transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              {t('nav.logout')}
            </button>
          </div>
        </div>
      </dialog>
    </aside>
  )
}

export default Sidebar
