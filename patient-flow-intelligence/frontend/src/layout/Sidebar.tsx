import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import { hasAdminRole, useKeycloak } from '../auth/context'

interface MenuItem {
  labelKey: string
  path: string
  icon: string // placeholder — trocar por lucide-react quando houver ícones
}

const SECTIONS: Record<string, MenuItem[]> = {
  menu: [
    { labelKey: 'nav.dashboard', path: '/dashboard', icon: '⊞' },
    { labelKey: 'nav.service', path: '/service', icon: '✦' },
  ],
  settings: [
    { labelKey: 'nav.settings', path: '/settings', icon: '⚙' },
    { labelKey: 'nav.account', path: '/user', icon: '👤' },
  ],
  support: [{ labelKey: 'nav.help', path: '/help', icon: '?' }],
}

const linkBase =
  'mb-1 flex items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-[5px] px-2.5 py-2 text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700'

const Sidebar = () => {
  const { keycloak, user } = useKeycloak()
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)

  const sections = {
    ...SECTIONS,
    ...(hasAdminRole(user?.roles) ? { administration: [{ labelKey: 'nav.admin', path: '/admin', icon: '⚙' }] } : {}),
  }

  return (
    <aside
      className={`relative flex h-screen shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-[205px]'}`}
    >
      <div
        className={`flex items-center gap-2.5 border-b border-gray-200 ${collapsed ? 'flex-col py-3' : 'h-[77px] px-3'}`}
      >
        <img src="https://placehold.co/31x31" alt="Logo" className="h-[31px] w-[31px] shrink-0 rounded" />
        {!collapsed && <span className="truncate text-[13px] font-medium text-black">{t('app.name')}</span>}
        <button
          type="button"
          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-primary ${collapsed ? '' : 'ml-auto'}`}
          onClick={() => setCollapsed((c) => !c)}
          title={t(collapsed ? 'nav.expand' : 'nav.collapse')}
          aria-label={t(collapsed ? 'nav.expand' : 'nav.collapse')}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <nav className={`flex-1 overflow-y-auto overflow-x-hidden py-[18px] ${collapsed ? 'px-2' : 'px-3'}`}>
        {Object.entries(sections).map(([section, items]) => (
          <div key={section} className="mb-[18px]">
            {!collapsed && (
              <div className="mb-2 pl-2.5 text-[10px] font-medium whitespace-nowrap text-[#aeb4be]">{t(`nav.${section}`)}</div>
            )}
            {items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `${linkBase} ${collapsed ? 'justify-center px-0' : ''} ${isActive ? 'bg-[rgba(176,210,252,0.45)] text-primary' : ''}`
                }
                title={collapsed ? t(item.labelKey) : undefined}
              >
                <span className="inline-block w-5 shrink-0 text-center text-sm">{item.icon}</span>
                {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
              </NavLink>
            ))}
          </div>
        ))}

        <div className="mb-[18px]">
          {!collapsed && <div className="mb-2 pl-2.5 text-[10px] font-medium text-[#aeb4be]">{t('nav.support')}</div>}
          <button
            type="button"
            className={`${linkBase} w-full text-left text-danger hover:bg-red-50 hover:text-danger ${collapsed ? 'justify-center px-0' : ''}`}
            onClick={() => keycloak.logout()}
            title={collapsed ? t('nav.logout') : undefined}
          >
            <span className="inline-block w-5 shrink-0 text-center text-sm">⏻</span>
            {!collapsed && <span className="truncate">{t('nav.logout')}</span>}
          </button>
        </div>
      </nav>
    </aside>
  )
}

export default Sidebar
