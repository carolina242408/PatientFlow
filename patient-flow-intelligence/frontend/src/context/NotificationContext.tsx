import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useKeycloak, hasAdminRole } from '../auth/context'
import { requestEventTicket, type DomainEventMessage, type DomainEventType } from '../api/events'

export interface AppNotification {
  id: string
  type: DomainEventType
  titleKey: string
  bodyKey: string
  defaultTitle: string
  defaultBody: string
  time: string
  read: boolean
  resourceType?: string
  resourceId?: string | null
  iconType: 'bed' | 'patient' | 'discharge' | 'transfer' | 'hierarchy' | 'system'
}

export interface NotificationContextType {
  notifications: AppNotification[]
  unreadCount: number
  connected: boolean
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  clearNotifications: () => void
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined)

const STORAGE_KEY = 'pfi_user_notifications'

function getInitialNotifications(): AppNotification[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      return JSON.parse(raw) as AppNotification[]
    }
  } catch {
    // Ignore storage parse error
  }
  return []
}

function getEventConfig(type: DomainEventType): {
  titleKey: string
  bodyKey: string
  defaultTitle: string
  defaultBody: string
  iconType: AppNotification['iconType']
  skipNotification?: boolean
} {
  switch (type) {
    case 'BED_STATUS_CHANGED':
      return {
        titleKey: 'topbar.notificationItems.bedStatusChanged.title',
        bodyKey: 'topbar.notificationItems.bedStatusChanged.body',
        defaultTitle: 'Bed status updated',
        defaultBody: 'A bed status was changed in your assigned scope.',
        iconType: 'bed',
      }
    case 'PATIENT_ADMITTED':
      return {
        titleKey: 'topbar.notificationItems.patientAdmitted.title',
        bodyKey: 'topbar.notificationItems.patientAdmitted.body',
        defaultTitle: 'Patient admitted',
        defaultBody: 'A patient was admitted to a bed.',
        iconType: 'patient',
      }
    case 'PATIENT_DISCHARGED':
      return {
        titleKey: 'topbar.notificationItems.patientDischarged.title',
        bodyKey: 'topbar.notificationItems.patientDischarged.body',
        defaultTitle: 'Patient discharged',
        defaultBody: 'A patient discharge was completed.',
        iconType: 'discharge',
      }
    case 'PATIENT_TRANSFERRED':
      return {
        titleKey: 'topbar.notificationItems.patientTransferred.title',
        bodyKey: 'topbar.notificationItems.patientTransferred.body',
        defaultTitle: 'Patient transferred',
        defaultBody: 'A patient was transferred to a new bed or service.',
        iconType: 'transfer',
      }
    case 'DISCHARGE_PLAN_CHANGED':
      return {
        titleKey: 'topbar.notificationItems.dischargePlanChanged.title',
        bodyKey: 'topbar.notificationItems.dischargePlanChanged.body',
        defaultTitle: 'Discharge plan updated',
        defaultBody: 'The discharge plan or forecast was updated.',
        iconType: 'discharge',
      }
    case 'CLINICAL_DISCHARGE_RECORDED':
      return {
        titleKey: 'topbar.notificationItems.clinicalDischargeRecorded.title',
        bodyKey: 'topbar.notificationItems.clinicalDischargeRecorded.body',
        defaultTitle: 'Clinical discharge recorded',
        defaultBody: 'A clinical discharge was recorded for a patient.',
        iconType: 'discharge',
      }
    case 'ADMISSION_REQUEST_CREATED':
    case 'ADMISSION_REQUEST_UPDATED':
    case 'ADMISSION_REQUEST_ADMITTED':
    case 'ADMISSION_REQUEST_CANCELLED':
      return {
        titleKey: 'topbar.notificationItems.admissionRequest.title',
        bodyKey: 'topbar.notificationItems.admissionRequest.body',
        defaultTitle: 'Admission request updated',
        defaultBody: 'An admission request was updated.',
        iconType: 'patient',
      }
    case 'HIERARCHY_CREATED':
    case 'HIERARCHY_UPDATED':
    case 'HIERARCHY_DELETED':
      return {
        titleKey: 'topbar.notificationItems.hierarchyChanged.title',
        bodyKey: 'topbar.notificationItems.hierarchyChanged.body',
        defaultTitle: 'Hierarchy updated',
        defaultBody: 'Hospital structure or services were modified.',
        iconType: 'hierarchy',
      }
    case 'ACCESS_CHANGED':
      return {
        titleKey: 'topbar.notificationItems.accessChanged.title',
        bodyKey: 'topbar.notificationItems.accessChanged.body',
        defaultTitle: 'Permissions updated',
        defaultBody: 'Your user grants or operational roles were updated.',
        iconType: 'system',
      }
    case 'RESYNC_REQUIRED':
    default:
      return {
        titleKey: '',
        bodyKey: '',
        defaultTitle: '',
        defaultBody: '',
        iconType: 'system',
        skipNotification: true,
      }
  }
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, keycloak } = useKeycloak()
  const queryClient = useQueryClient()
  const [notifications, setNotifications] = useState<AppNotification[]>(getInitialNotifications)
  const [connected, setConnected] = useState(false)

  const seenEventIds = useRef<Set<string>>(new Set())
  const hasAccess = Boolean(keycloak?.authenticated && user && (hasAdminRole(user.roles) || Boolean(user.scopeType)))

  // Persist notifications to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(notifications))
    } catch {
      // Ignore storage error
    }
  }, [notifications])

  const handleIncomingMessage = useCallback(
    (message: DomainEventMessage) => {
      if (!message.id || seenEventIds.current.has(message.id)) return
      seenEventIds.current.add(message.id)

      // Keep seen set under 200 entries to prevent memory leak
      if (seenEventIds.current.size > 200) {
        const first = seenEventIds.current.values().next().value
        if (first) seenEventIds.current.delete(first)
      }

      const { type } = message

      // 1. Invalidate TanStack query cache based on event type
      if (type === 'RESYNC_REQUIRED') {
        void queryClient.invalidateQueries({ queryKey: ['space-beds-room'] })
        void queryClient.invalidateQueries({ queryKey: ['space-occupied-patients'] })
        void queryClient.invalidateQueries({ queryKey: ['space-bed-summary-current'] })
        void queryClient.invalidateQueries({ queryKey: ['dashboard-occupancy'] })
        void queryClient.invalidateQueries({ queryKey: ['space-hierarchy-children'] })
        void queryClient.invalidateQueries({ queryKey: ['manager-hierarchy-roots'] })
        void queryClient.invalidateQueries({ queryKey: ['encounters'] })
        void queryClient.invalidateQueries({ queryKey: ['patients'] })
        void queryClient.invalidateQueries({ queryKey: ['admission-requests'] })
        void queryClient.invalidateQueries({ queryKey: ['lhu-hierarchy'] })
        return
      }

      if (type === 'BED_STATUS_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: ['space-beds-room'] })
        void queryClient.invalidateQueries({ queryKey: ['space-bed-summary-current'] })
        void queryClient.invalidateQueries({ queryKey: ['dashboard-occupancy'] })
      } else if (
        type === 'PATIENT_ADMITTED' ||
        type === 'PATIENT_DISCHARGED' ||
        type === 'PATIENT_TRANSFERRED'
      ) {
        void queryClient.invalidateQueries({ queryKey: ['space-beds-room'] })
        void queryClient.invalidateQueries({ queryKey: ['space-occupied-patients'] })
        void queryClient.invalidateQueries({ queryKey: ['space-bed-summary-current'] })
        void queryClient.invalidateQueries({ queryKey: ['dashboard-occupancy'] })
        void queryClient.invalidateQueries({ queryKey: ['encounters'] })
        void queryClient.invalidateQueries({ queryKey: ['patients'] })
      } else if (type === 'DISCHARGE_PLAN_CHANGED' || type === 'CLINICAL_DISCHARGE_RECORDED') {
        void queryClient.invalidateQueries({ queryKey: ['space-occupied-patients'] })
        void queryClient.invalidateQueries({ queryKey: ['dashboard-occupancy'] })
        void queryClient.invalidateQueries({ queryKey: ['encounters'] })
      } else if (type.startsWith('ADMISSION_REQUEST')) {
        void queryClient.invalidateQueries({ queryKey: ['admission-requests'] })
        void queryClient.invalidateQueries({ queryKey: ['dashboard-occupancy'] })
      } else if (type.startsWith('HIERARCHY')) {
        void queryClient.invalidateQueries({ queryKey: ['space-hierarchy-children'] })
        void queryClient.invalidateQueries({ queryKey: ['manager-hierarchy-roots'] })
        void queryClient.invalidateQueries({ queryKey: ['lhu-hierarchy'] })
      } else if (type === 'ACCESS_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: ['access'] })
      }

      // 2. Add to notification list if not skipped
      const config = getEventConfig(type)
      if (config.skipNotification) return

      const notification: AppNotification = {
        id: message.id,
        type,
        titleKey: config.titleKey,
        bodyKey: config.bodyKey,
        defaultTitle: config.defaultTitle,
        defaultBody: config.defaultBody,
        time: message.occurredAt || new Date().toISOString(),
        read: false,
        resourceType: message.resourceType,
        resourceId: message.resourceId,
        iconType: config.iconType,
      }

      setNotifications((prev) => [notification, ...prev.slice(0, 49)])
    },
    [queryClient],
  )

  useEffect(() => {
    if (!hasAccess) return

    let isUnmounted = false
    let ws: WebSocket | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let retryAttempt = 0

    async function establishConnection() {
      if (isUnmounted) return

      try {
        const ticketResponse = await requestEventTicket()
        if (isUnmounted) return

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = `${protocol}//${window.location.host}${ticketResponse.path}?ticket=${encodeURIComponent(ticketResponse.ticket)}`

        ws = new WebSocket(wsUrl)

        ws.onopen = () => {
          if (isUnmounted) {
            ws?.close()
            return
          }
          setConnected(true)
          retryAttempt = 0
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as DomainEventMessage
            handleIncomingMessage(data)
          } catch (err) {
            console.error('Error parsing WebSocket event:', err)
          }
        }

        ws.onclose = () => {
          setConnected(false)
          ws = null
          if (!isUnmounted) {
            scheduleRetry()
          }
        }

        ws.onerror = () => {
          // Handled by onclose
        }
      } catch {
        setConnected(false)
        if (!isUnmounted) {
          scheduleRetry()
        }
      }
    }

    function scheduleRetry() {
      if (isUnmounted || reconnectTimeout) return
      const baseDelay = Math.min(1000 * Math.pow(2, retryAttempt), 30000)
      const jitter = Math.random() * 1000
      retryAttempt++
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null
        void establishConnection()
      }, baseDelay + jitter)
    }

    void establishConnection()

    return () => {
      isUnmounted = true
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      if (ws) {
        ws.onclose = null
        ws.onerror = null
        ws.close()
      }
      setConnected(false)
    }
  }, [hasAccess, handleIncomingMessage, user?.username])

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((notif) => (notif.id === id ? { ...notif, read: true } : notif)),
    )
  }, [])

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((notif) => ({ ...notif, read: true })))
  }, [])

  const clearNotifications = useCallback(() => {
    setNotifications([])
  }, [])

  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        connected,
        markAsRead,
        markAllAsRead,
        clearNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider')
  }
  return context
}
