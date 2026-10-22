import { useTranslation } from 'react-i18next'

const Account = () => {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className="text-xl font-medium">{t('account.title')}</h1>
      <p className="mt-2 text-sm text-gray-500">{t('account.body')}</p>
    </div>
  )
}

export default Account