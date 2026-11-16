import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  BedSingle,
  CalendarDays,
  CircleAlert,
  Building2,
  UserPlus,
  Shield,
  CheckCheck,
  Trash2,
  ArrowLeftRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { useNotifications, type AppNotification } from '../context/NotificationContext'

const ICON_MAP: Record<AppNotification['iconType'], LucideIcon> = {
  bed: BedSingle,
  patient: UserPlus,
  discharge: CalendarDays,
  transfer: ArrowLeftRight,
  hierarchy: Building2,
  system: Shield,
}

function formatRelativeTime(
  dateIso: string,
  justNowText: string,
  lang?: string,
): string {
  const date = new Date(dateIso)
  if (Number.isNaN(date.getTime())) return '—'
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diffSec < 60) return justNowText
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h`
  return new Intl.DateTimeFormat(lang, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const NotificationPopover = () => {
  const { t, i18n } = useTranslation()
  const {
    notifications,
    unreadCount,
    connected,
    markAsRead,
    markAllAsRead,
    clearNotifications,
  } = useNotifications()

  const [isOpen, setIsOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

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

  return (
    <div ref={popoverRef} className="relative">
      <Button
        type="button"
        variant="ghost"
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
      </Button>

      {isOpen && (
        <section
          id="user-notifications"
          aria-label={t('topbar.notifications')}
          className="notification-panel absolute right-0 top-12 z-50 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
        >
          <header className="border-b border-gray-100 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900">
                  {t('topbar.notifications')}
                </h2>
                <span
                  title={connected ? t('topbar.liveConnected') : t('topbar.liveDisconnected')}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    connected
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      connected ? 'animate-pulse bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  {connected ? t('topbar.liveConnected') : t('topbar.liveDisconnected')}
                </span>
              </div>

              <Badge className="rounded-full border-0 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                {t('topbar.unreadCount', { count: unreadCount })}
              </Badge>
            </div>

            <p className="mt-1 text-xs text-gray-500">{t('topbar.sampleNotifications')}</p>

            <div className="mt-3 flex items-center justify-between gap-2">
              {unreadCount > 0 ? (
                <Button
                  type="button"
                  variant="link"
                  onClick={markAllAsRead}
                  className="flex items-center gap-1 p-0 text-xs font-medium text-blue-600 hover:underline"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {t('topbar.markAllRead')}
                </Button>
              ) : <div />}

              {notifications.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearNotifications}
                  className="flex items-center gap-1 p-1 text-xs text-gray-400 hover:text-red-600"
                  title={t('topbar.clearAll', 'Clear all')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('topbar.clearAll', 'Clear all')}
                </Button>
              )}
            </div>
          </header>

          <ul className="max-h-[min(28rem,65vh)] overflow-y-auto divide-y divide-gray-100">
            {notifications.length === 0 ? (
              <li className="flex flex-col items-center justify-center px-6 py-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-400">
                  <Bell className="h-6 w-6 stroke-[1.5]" />
                </span>
                <p className="mt-3 text-sm font-medium text-slate-700">
                  {t('topbar.noNotifications', 'No notifications yet')}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {t('topbar.sampleNotifications')}
                </p>
              </li>
            ) : (
              notifications.map((notif) => {
                const Icon = ICON_MAP[notif.iconType] ?? CircleAlert
                const title = notif.titleKey
                  ? t(notif.titleKey, notif.defaultTitle)
                  : notif.defaultTitle
                const body = notif.bodyKey
                  ? t(notif.bodyKey, notif.defaultBody)
                  : notif.defaultBody
                const time = formatRelativeTime(
                  notif.time,
                  t('topbar.justNow', 'Just now'),
                  i18n.resolvedLanguage,
                )

                return (
                  <li key={notif.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => markAsRead(notif.id)}
                      aria-label={`${title}. ${body} ${!notif.read ? t('topbar.markRead') : ''}`}
                      className={`notification-row h-auto flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50 ${
                        !notif.read ? 'notification-unread bg-blue-50/50' : 'bg-white'
                      }`}
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                        <Icon aria-hidden="true" className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">{title}</span>
                          {!notif.read && (
                            <span
                              aria-label={t('topbar.unread')}
                              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600"
                            />
                          )}
                        </span>
                        <span className="mt-1 block text-sm leading-5 text-gray-600">
                          {body}
                        </span>
                        <span className="mt-2 block text-xs text-gray-400">{time}</span>
                      </span>
                    </Button>
                  </li>
                )
              })
            )}
          </ul>
        </section>
      )}
    </div>
  )
}

export default NotificationPopover
