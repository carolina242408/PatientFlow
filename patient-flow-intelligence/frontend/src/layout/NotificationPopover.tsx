import { useEffect, useRef, useState } from 'react'
import { Bell, BedSingle, CalendarDays, CircleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const INITIAL_NOTIFICATIONS = [
  {
    id: 'occupancy',
    titleKey: 'topbar.notificationItems.occupancy.title',
    bodyKey: 'topbar.notificationItems.occupancy.body',
    timeKey: 'topbar.notificationItems.occupancy.time',
    Icon: CircleAlert,
  },
  {
    id: 'bed',
    titleKey: 'topbar.notificationItems.bed.title',
    bodyKey: 'topbar.notificationItems.bed.body',
    timeKey: 'topbar.notificationItems.bed.time',
    Icon: BedSingle,
  },
  {
    id: 'discharge',
    titleKey: 'topbar.notificationItems.discharge.title',
    bodyKey: 'topbar.notificationItems.discharge.body',
    timeKey: 'topbar.notificationItems.discharge.time',
    Icon: CalendarDays,
  },
]

const NotificationPopover = () => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [unreadIds, setUnreadIds] = useState(() => INITIAL_NOTIFICATIONS.map(({ id }) => id))
  const popoverRef = useRef<HTMLDivElement>(null)
  const unreadCount = unreadIds.length

  useEffect(() => {
    if (!isOpen) return

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !popoverRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  const markRead = (id: string) => {
    setUnreadIds((ids) => ids.filter((unreadId) => unreadId !== id))
  }

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        aria-label={t('topbar.notifications')}
        aria-expanded={isOpen}
        aria-controls="user-notifications"
        onClick={() => setIsOpen((open) => !open)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-gray-100 hover:text-slate-700"
      >
        <Bell aria-hidden="true" className="h-5 w-5" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500"
          />
        )}
      </button>

      {isOpen && (
        <section
          id="user-notifications"
          aria-label={t('topbar.notifications')}
          className="notification-panel absolute right-0 top-12 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
        >
          <header className="border-b border-gray-100 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">
                {t('topbar.notifications')}
              </h2>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                {t('topbar.unreadCount', { count: unreadCount })}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">{t('topbar.sampleNotifications')}</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => setUnreadIds([])}
                className="mt-3 text-xs font-medium text-blue-600 hover:underline"
              >
                {t('topbar.markAllRead')}
              </button>
            )}
          </header>

          <ul className="max-h-[min(28rem,65vh)] overflow-y-auto">
            {INITIAL_NOTIFICATIONS.map(({ id, titleKey, bodyKey, timeKey, Icon }) => {
              const isUnread = unreadIds.includes(id)
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => markRead(id)}
                    aria-label={`${t(titleKey)}. ${t(bodyKey)} ${isUnread ? t('topbar.markRead') : ''}`}
                    className={`notification-row flex w-full items-start gap-3 border-b border-gray-100 px-5 py-4 text-left transition-colors hover:bg-gray-50 ${
                      isUnread ? 'notification-unread bg-blue-50/60' : 'bg-white'
                    }`}
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                      <Icon aria-hidden="true" className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">{t(titleKey)}</span>
                        {isUnread && (
                          <span
                            aria-label={t('topbar.unread')}
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600"
                          />
                        )}
                      </span>
                      <span className="mt-1 block text-sm leading-5 text-gray-600">{t(bodyKey)}</span>
                      <span className="mt-2 block text-xs text-gray-400">{t(timeKey)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

export default NotificationPopover
