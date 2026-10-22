import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import { useKeycloak } from '../auth/context'

import logoIcon from '/assets/app-logo.png'
import arrowIcon from '/assets/sidebar/arrow.svg'
import dashboardIcon from '/assets/sidebar/dashboard.svg'
import settingsIcon from '/assets/sidebar/settings.svg'
import userIcon from '/assets/sidebar/user.svg'
import helpIcon from '/assets/sidebar/help.svg'
import logoutIcon from '/assets/sidebar/logout.svg'

import managerIcon from '/assets/sidebar/manager.svg'
import adminIcon from '/assets/sidebar/admin.svg'

interface SidebarItem {
  labelKey: string
  path?: string
  icon: string
}

const getManagementSidebarItem = (roles: string[] = []): SidebarItem | null => {
  if (roles.includes('ROLE_ADMIN')) {
    return { labelKey: 'nav.admin', path: '/admin', icon: adminIcon }
  }
  if (roles.includes('LHU_MANAGER')) {
    return { labelKey: 'nav.lhu', path: '/lhu', icon: managerIcon }
  }
  if (roles.includes('UNIT_MANAGER')) {
    return { labelKey: 'nav.unit', path: '/unit', icon: managerIcon }
  }
    if (roles.includes('SERVICE_MANAGER')) {
    return { labelKey: 'nav.service', path: '/service', icon: managerIcon }
  }
  return null
}

const Sidebar = () => {
  const { keycloak, user } = useKeycloak()
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const roleIcon = getManagementSidebarItem(user?.roles)

  const sections : Record<string, SidebarItem[]> = {
    Menu: [
      { labelKey: 'nav.dashboard', path: '/dashboard', icon: dashboardIcon},
      ...(roleIcon ? [roleIcon] : []),
    ],
    Settings: [
      { labelKey: 'nav.settings', path: '/settings', icon: settingsIcon },
      { labelKey: 'nav.account', path: '/user', icon: userIcon },
    ],
  }

  return (
    <aside
      className={`relative flex h-screen shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-[230px]'}`}
    >
      <div className={`flex items-center border-b border-gray-100 py-4 ${collapsed ? 'justify-center px-1.5' : 'gap-3 px-4'}`}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
          <img src={logoIcon} alt="Logo" className="h-6 w-6 object-contain brightness-0 invert" />
        </div>
        {!collapsed && (
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-[14px] font-semibold text-slate-900 leading-tight">
              Service Workspace
            </span>
            <span className="truncate text-[12px] font-normal text-slate-400">
              Cardiology Service
            </span>
          </div>
        )}
        
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="absolute -right-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-slate-400 shadow-sm hover:bg-gray-50 hover:text-slate-600 z-10"
          title={t(collapsed ? 'nav.expand' : 'nav.collapse')}
        >
          <img src={arrowIcon} alt="" className={`h-4 w-4 transition-transform duration-200 ${collapsed ? 'rotate-270' : 'rotate-90'}`}/>
        </button>
      </div>

      {/* Main Menu */}
      <nav className={`flex-1 overflow-y-auto py-5 ${collapsed ? 'px-2' : 'px-3'}`}>
        {Object.entries(sections).map(([section, items]) => (
          <div key={section} className="mb-6">
            {!collapsed && (<div className="mb-2 pl-3 text-[12px] font-medium text-slate-400"> {section} </div>)}
            {items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path!}
                className={({ isActive }) =>
                  `mb-1 flex items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-[14px] font-medium transition-colors ${collapsed ? 'justify-center px-0' : ''} ${
                    isActive
                      ? 'bg-blue-50 text-blue-600 font-semibold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`
                }
                title={collapsed ? t(item.labelKey) : undefined}
              >
                {({ isActive }) => (
                <>
                  <img src={item.icon} alt="" className={`h-5 w-5 shrink-0 object-contain transition-all ${
                      isActive ? 'sidebar-icon-active' : 'sidebar-icon-inactive'}`}
                  />
                  {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
                </>
              )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className={`border-t border-gray-100 py-4 ${collapsed ? 'px-2' : 'px-3'}`}>
        {/* Logout Button */}
        <button
          type="button"
          onClick={() => keycloak.logout()}
          className={`mb-1 flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-[14px] font-semibold text-red-600 transition-colors hover:bg-red-50 ${
            collapsed ? 'justify-center px-0' : ''
          }`}
          title={collapsed ? t('nav.logout') : undefined}
        >
          <img src={logoutIcon} alt="" className="h-5 w-5 shrink-0 object-contain sidebar-icon-danger" />
          {!collapsed && <span className="truncate">{t('nav.logout')}</span>}
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
          <img src={helpIcon} alt="" className="h-5 w-5 shrink-0 object-contain opacity-70" />
          {!collapsed && <span className="truncate">Help Center</span>}
        </NavLink>
      </div>
    </aside>
  )
}

export default Sidebar
