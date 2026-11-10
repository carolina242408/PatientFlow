import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/Card'
import { useKeycloak } from '@/auth/context'
import { fetchAccount } from '../api/account'

const getProfile = (roles: string[] = []) => {
  if (roles.includes('ROLE_ADMIN')) return 'admin'
  if (roles.includes('MANAGER')) return 'manager'
  return 'default'
}

const getInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')

const Field = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</dt>
    <dd className="mt-1.5 text-base text-slate-900">{value}</dd>
  </div>
)

const Account = () => {
  const { t, i18n } = useTranslation()
  const { user } = useKeycloak()
  const { data: account, isPending, isError } = useQuery({
    queryKey: ['account'],
    queryFn: fetchAccount,
  })

  const name = account?.name || account?.login || '—'
  const email = account?.email || '—'
  const roles = user?.roles ?? account?.roles ?? []
  const hasAdminRole = roles.includes('ROLE_ADMIN')
  const hasManagerRole = roles.includes('MANAGER')
  const hasApplicationRole = hasAdminRole || hasManagerRole
  const scopeType = user?.scopeType
  const hasScope = scopeType !== null && scopeType !== undefined
  const profile = getProfile(roles)
  const profileLabel = hasApplicationRole
    ? t(`account.profiles.${profile}`)
    : t('account.profiles.none')
  const scopeLabel = hasAdminRole
    ? t('account.scopes.admin')
    : hasScope
      ? t(`account.scopeLevels.${scopeType}`)
      : t('account.scopes.default')
  const accessDescription = !hasApplicationRole && !hasScope
    ? t('account.access.missingRoleAndScope')
    : !hasApplicationRole
      ? t('account.access.missingRoleDescription')
      : !hasScope
        ? t('account.access.missingScopeDescription')
        : t(`account.access.${profile}`)
  const languageLabel = t(`account.languages.${i18n.resolvedLanguage ?? 'en'}`, {
    defaultValue: i18n.resolvedLanguage ?? 'English',
  })

  if (isPending) {
    return <Card className="gap-0 rounded-2xl p-10 shadow-sm">Loading...</Card>
  }

  if (isError || !account) {
    return <Card className="gap-0 rounded-2xl p-10 shadow-sm">{t('account.error')}</Card>
  }

  return (
    <Card className="gap-0 rounded-2xl p-10 shadow-sm">
      {/* Header */}
      <header className="flex items-center gap-5 border-b border-gray-200 pb-8">
        <div
          aria-hidden="true"
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-blue-50 text-2xl font-semibold text-blue-600"
        >
          {getInitials(name)}
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{name}</h1>
          <p className="mt-2 text-sm text-gray-500">
            {t('account.subtitle', { profile: profileLabel })}
          </p>
        </div>
      </header>

      {/* Details */}
      <dl className="grid grid-cols-1 gap-x-12 gap-y-7 py-8 md:grid-cols-2">
        <Field label={t('account.fullName')} value={name} />
        <Field label={t('account.email')} value={email} />
        <Field label={t('account.profile')} value={profileLabel} />
        <Field label={t('account.scope')} value={scopeLabel} />
        <Field label={t('account.status')} value={t('account.active')} />
        <Field label={t('account.language')} value={languageLabel} />
      </dl>

      {/* Access info */}
      <section className="rounded-xl bg-slate-50 p-6">
        <h2 className="text-base font-semibold text-slate-900">{t('account.access.title')}</h2>
        <p className={`mt-2 text-sm leading-relaxed ${!hasApplicationRole || (!hasScope && !hasAdminRole) ? 'font-medium text-red-700' : 'text-gray-500'}`}>
          {accessDescription}
        </p>
      </section>
    </Card>
  )
}

export default Account