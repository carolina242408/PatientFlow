import { useTranslation } from 'react-i18next'

const Unit = () => {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className="text-xl font-medium">{t('unit.title')}</h1>
      <p className="mt-2 text-sm text-gray-500">{t('unit.body')}</p>
    </div>
  )
}

export default Unit
