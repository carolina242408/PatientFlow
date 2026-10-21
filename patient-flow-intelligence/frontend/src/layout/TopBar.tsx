import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKeycloak } from '../auth/context'
import { LANGUAGES } from '../i18n'

interface TopBarProps {
  pageName: string
  pageDescription: string
}

const TopBar = ({ pageName, pageDescription }: TopBarProps) => {
  const { user, keycloak } = useKeycloak()
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !e.composedPath().includes(ref.current)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const displayRole = () => {
    const roles = user?.roles ?? []
    if (roles.some((r) => r.includes('ADMIN'))) return t('topbar.admin')
    const gestor = roles.find((r) => r.includes('GESTOR'))
    if (gestor) return gestor.replace('GESTOR_', 'Gestor ').replace(/_/g, ' ')
    return t('topbar.user')
  }

  return (
    <header className="relative flex h-[77px] w-full items-center border-b border-gray-200 bg-white px-6">
      <div className="flex flex-col justify-center">
        <h1 className="mb-0.5 text-base leading-tight font-semibold text-gray-900">{pageName}</h1>
        <p className="text-xs leading-tight text-gray-500">{pageDescription}</p>
      </div>

      <div className="flex-1" />

      <div className="relative" ref={ref}>
        <button
          type="button"
          className={`flex max-w-[250px] items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-gray-100 ${open ? 'bg-gray-100' : ''}`}
          onClick={() => setOpen((o) => !o)}
          title={user?.name}
        >
          <div className="h-8 w-8 min-w-8 rounded-full bg-[#d9d9d9]" />
          <div className="flex min-w-0 flex-col text-left">
            <span className="block truncate text-[13px] font-semibold text-gray-900">{user?.name || t('topbar.user')}</span>
            <span className="block truncate text-[9px] font-medium text-gray-500 uppercase">{displayRole()}</span>
          </div>
          <span className="ml-1 text-[10px] text-gray-500">▼</span>
        </button>

        {open && (
          <div className="absolute top-full right-0 z-50 mt-2 w-[200px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="flex flex-col bg-gray-50 px-4 py-3">
              <span className="text-[13px] font-semibold text-gray-900">{user?.name}</span>
              <span className="mt-0.5 text-[11px] text-gray-500">{user?.email}</span>
            </div>
            <div className="h-px bg-gray-200" />
            <div className="flex items-center gap-2 px-4 py-2 text-[13px] text-gray-700">
              <span>{t('topbar.language')}:</span>
              {LANGUAGES.map((lng) => (
                <button
                  key={lng}
                  type="button"
                  className={`rounded px-1.5 py-0.5 hover:bg-gray-100 ${i18n.language === lng ? 'font-semibold text-primary' : ''}`}
                  onClick={() => void i18n.changeLanguage(lng)}
                >
                  {lng}
                </button>
              ))}
            </div>
            <div className="h-px bg-gray-200" />
            <button type="button" className="w-full px-4 py-2.5 text-left text-[13px] text-gray-700 hover:bg-gray-100">
              {t('nav.account')}
            </button>
            <div className="h-px bg-gray-200" />
            <button
              type="button"
              className="w-full px-4 py-2.5 text-left text-[13px] text-danger hover:bg-red-50"
              onClick={() => keycloak.logout()}
            >
              {t('nav.logout')}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

export default TopBar
