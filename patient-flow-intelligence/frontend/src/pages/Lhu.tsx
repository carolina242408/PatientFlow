import { useTranslation } from 'react-i18next'

const Lhu = () => {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className="text-xl font-medium">{t('lhu.title')}</h1>
      <p className="mt-2 text-sm text-gray-500">{t('lhu.body')}</p>
    </div>
  )
}

export default Lhu
