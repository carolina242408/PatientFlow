import { useTranslation } from 'react-i18next'

const Service = () => {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className="text-xl font-medium">{t('service.title')}</h1>
      <p className="mt-2 text-sm text-gray-500">{t('service.body')}</p>
    </div>
  )
}

export default Service
