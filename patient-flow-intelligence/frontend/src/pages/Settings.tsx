import { useTranslation } from 'react-i18next'

const Settings = () => {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className="text-xl font-medium">{t('settings.title')}</h1>
      <p className="mt-2 text-sm text-gray-500">{t('settings.body')}</p>
    </div>
  )
}

export default Settings