import { useTranslation } from 'react-i18next'

interface LastUpdatedCardProps {
  timestamp: Date
  className?: string
}

export function LastUpdatedCard({ timestamp, className = '' }: LastUpdatedCardProps) {
  const { t, i18n } = useTranslation()

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 ${className}`.trim()}
    >
      {t('dashboard.lastUpdated', {
        time: new Intl.DateTimeFormat(i18n.resolvedLanguage, {
          hour: '2-digit',
          minute: '2-digit',
        }).format(timestamp),
      })}
    </div>
  )
}
