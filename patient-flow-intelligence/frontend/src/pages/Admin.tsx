import { useTranslation } from 'react-i18next'

const Admin = () => {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className="text-xl font-medium">{t('admin.title')}</h1>
      <p className="mt-2 text-sm text-gray-500">{t('admin.body')}</p>
    </div>
  )
}

export default Admin
