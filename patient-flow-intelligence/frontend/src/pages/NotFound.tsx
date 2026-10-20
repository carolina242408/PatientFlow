import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

const NotFound = () => {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className="text-xl font-medium">{t('notFound.title')}</h1>
      <Link to="/dashboard" className="mt-2 inline-block text-sm text-primary hover:underline">
        {t('notFound.back')}
      </Link>
    </div>
  )
}

export default NotFound
