import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import { useKeycloak } from '../auth/context'

interface TopBarProps {
  pageName: string
  pageDescription: string
}

const TopBar = ({ pageName, pageDescription }: TopBarProps) => {
  const { user } = useKeycloak()
  const { t } = useTranslation()

  // Gerar iniciais do utilizador 
  const getInitials = (name?: string) => {
    if (!name) return 'U'
    const parts = name.trim().split(' ')
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }

  return (
    <header className="relative flex h-[73px] w-full items-center border-b border-gray-200 bg-white px-8">
      {/* Informação da Página */}
      <div className="flex flex-col justify-center">
        <h1 className="text-xl font-bold text-slate-900 leading-tight">{pageName}</h1>
        <p className="mt-0.5 text-xs text-slate-400 font-normal">{pageDescription}</p>
      </div>

      <div className="flex-1" />

      {/* Lado Direito: Notificação + Perfil */}
      <div className="flex items-center gap-4">
        {/* Botão de Notificação */}
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-gray-100 hover:text-slate-700 transition-colors"
          title={t('topbar.notifications', 'Notificações')}
        >
          <Bell className="h-5 w-5" />
          {/* Ponto Vermelho de Notificação */}
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
        </button>

        {/* Divisor Vertical */}
        <div className="h-8 w-px bg-gray-200" />

        {/* Perfil */}
        <NavLink
          to="/account"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-1.5 transition-colors hover:bg-gray-50 ${
              isActive 
                ? 'bg-gray-100 border-gray-300' 
                : 'bg-white hover:bg-slate-100 hover:border-gray-300'
            }`
          }
          title={t('nav.account', 'Minha Conta')}
        >
          {/* Avatar com Iniciais */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-600">
            {getInitials(user?.name)}
          </div>

          {/* Nome do Utilizador */}
          <span className="text-[14px] font-medium text-slate-800">
            {user?.name || t('topbar.user')}
          </span>
        </NavLink>
      </div>
    </header>
  )
}

export default TopBar