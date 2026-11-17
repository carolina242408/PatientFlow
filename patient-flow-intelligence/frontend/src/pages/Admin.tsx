import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  Download,
  Eye,
  Filter,
  Globe,
  LogIn,
  LogOut,
  Monitor,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react'
import {
  fetchAuditLogs,
  fetchAuditStats,
  previewAuditRetention,
  runAuditCleanupNow,
  updateAuditRetention,
  type AuditEventType,
  type AuditLogEntry,
} from '@/api/audit'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Input } from '@/components/Input'
import { OperationPopup } from '@/components/OperationPopup'
import { Select, SelectOption } from '@/components/Select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/Table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/Tabs'

type TimePreset = 'ALL' | '1H' | '24H' | '7D' | '30D' | 'CUSTOM'

const TTL_PRESETS = [7, 14, 30, 60, 90, 180, 365]

function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date)
}

function formatRelativeTime(iso: string | null | undefined, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diffSec < 60) return t('admin.time.justNow')
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return t('admin.time.minutesAgo', { count: diffMin })
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return t('admin.time.hoursAgo', { count: diffHours })
  const diffDays = Math.floor(diffHours / 24)
  return t('admin.time.daysAgo', { count: diffDays })
}

function computePresetBounds(preset: TimePreset, customFrom: string, customTo: string): { from?: string; to?: string } {
  const now = Date.now()
  switch (preset) {
    case '1H':
      return { from: new Date(now - 3600_000).toISOString() }
    case '24H':
      return { from: new Date(now - 24 * 3600_000).toISOString() }
    case '7D':
      return { from: new Date(now - 7 * 24 * 3600_000).toISOString() }
    case '30D':
      return { from: new Date(now - 30 * 24 * 3600_000).toISOString() }
    case 'CUSTOM': {
      const fromIso = customFrom ? new Date(customFrom).toISOString() : undefined
      const toIso = customTo ? new Date(customTo).toISOString() : undefined
      return { from: fromIso, to: toIso }
    }
    default:
      return {}
  }
}

const Admin = () => {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const locale = i18n.resolvedLanguage || 'en'

  // Tabs state
  const [activeTab, setActiveTab] = useState<'logs' | 'retention'>('logs')

  // Filters state
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [eventType, setEventType] = useState<string>('ALL')
  const [role, setRole] = useState<string>('ALL')
  const [pagePath, setPagePath] = useState<string>('ALL')
  const [username, setUsername] = useState<string>('ALL')
  const [ipAddress, setIpAddress] = useState<string>('')
  const [timePreset, setTimePreset] = useState<TimePreset>('ALL')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [page, setPage] = useState<number>(0)
  const [size, setSize] = useState<number>(25)

  // Detail modal state
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null)

  // TTL Configuration & Two-step Double-Check ("Are You Sure?") state
  const [customTtlDays, setCustomTtlDays] = useState<number | null>(null)
  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0) // 0=closed, 1=impact review, 2="are you sure" final check
  const [doubleCheckAccepted, setDoubleCheckAccepted] = useState<boolean>(false)
  const [popup, setPopup] = useState<{
    type: 'success' | 'error'
    title: string
    description: string
    key: number
  } | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput)
      setPage(0)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const timeBounds = useMemo(
    () => computePresetBounds(timePreset, customFrom, customTo),
    [timePreset, customFrom, customTo],
  )

  const filterParams = useMemo(
    () => ({
      search: debouncedSearch,
      eventType,
      role,
      pagePath,
      username,
      ipAddress,
      from: timeBounds.from,
      to: timeBounds.to,
      page,
      size,
    }),
    [debouncedSearch, eventType, role, pagePath, username, ipAddress, timeBounds, page, size],
  )

  const logsQuery = useQuery({
    queryKey: ['audit-logs', filterParams],
    queryFn: () => fetchAuditLogs(filterParams),
    refetchInterval: 15_000,
  })

  const statsQuery = useQuery({
    queryKey: [
      'audit-stats',
      debouncedSearch,
      eventType,
      role,
      pagePath,
      username,
      ipAddress,
      timeBounds.from,
      timeBounds.to,
    ],
    queryFn: () =>
      fetchAuditStats({
        search: debouncedSearch,
        eventType,
        role,
        pagePath,
        username,
        ipAddress,
        from: timeBounds.from,
        to: timeBounds.to,
      }),
    refetchInterval: 15_000,
  })

  const retention = statsQuery.data?.retention
  const candidateTtlDays = customTtlDays ?? retention?.ttlDays ?? 30

  const validCandidateTtl =
    Number.isFinite(candidateTtlDays) && candidateTtlDays >= 1 && candidateTtlDays <= 3650
      ? candidateTtlDays
      : 30

  const previewQuery = useQuery({
    queryKey: ['audit-retention-preview', validCandidateTtl],
    queryFn: () => previewAuditRetention(validCandidateTtl),
    enabled: activeTab === 'retention' || confirmStep > 0,
  })

  const updateTtlMutation = useMutation({
    mutationFn: ({ ttlDays, confirmed }: { ttlDays: number; confirmed: boolean }) =>
      updateAuditRetention(ttlDays, confirmed),
    onSuccess: (res) => {
      setConfirmStep(0)
      setDoubleCheckAccepted(false)
      setCustomTtlDays(res.retention.ttlDays)
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
      void queryClient.invalidateQueries({ queryKey: ['audit-stats'] })
      void queryClient.invalidateQueries({ queryKey: ['audit-retention-preview'] })
      setPopup({
        type: 'success',
        title: t('admin.retention.popup.updatedTitle'),
        description: t('admin.retention.popup.updatedDesc', {
          days: res.retention.ttlDays,
          deleted: res.deletedCount,
        }),
        key: Date.now(),
      })
    },
    onError: () => {
      setPopup({
        type: 'error',
        title: t('admin.retention.popup.errorTitle'),
        description: t('admin.retention.popup.errorDesc'),
        key: Date.now(),
      })
    },
  })

  const cleanupNowMutation = useMutation({
    mutationFn: () => runAuditCleanupNow(),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
      void queryClient.invalidateQueries({ queryKey: ['audit-stats'] })
      void queryClient.invalidateQueries({ queryKey: ['audit-retention-preview'] })
      setPopup({
        type: 'success',
        title: t('admin.retention.popup.cleanupTitle'),
        description: t('admin.retention.popup.cleanupDesc', { deleted: res.deletedCount }),
        key: Date.now(),
      })
    },
  })

  const handleResetFilters = () => {
    setSearchInput('')
    setDebouncedSearch('')
    setEventType('ALL')
    setRole('ALL')
    setPagePath('ALL')
    setUsername('ALL')
    setIpAddress('')
    setTimePreset('ALL')
    setCustomFrom('')
    setCustomTo('')
    setPage(0)
  }

  const handleExportCsv = () => {
    const items = logsQuery.data?.items ?? []
    if (items.length === 0) return
    const headers = [
      'Timestamp',
      'Event Type',
      'Username',
      'Full Name',
      'Email',
      'Roles',
      'Page Path',
      'Page Title',
      'IP Address',
      'Origin',
      'Session ID',
      'Expires At',
    ]
    const escapeCsv = (val: unknown) => {
      const str = val === null || val === undefined ? '' : String(val)
      return `"${str.replace(/"/g, '""')}"`
    }
    const rows = items.map((item) =>
      [
        item.occurredAt,
        item.eventType,
        item.username,
        item.userFullName ?? '',
        item.userEmail ?? '',
        item.userRoles.join(';'),
        item.pagePath,
        item.pageTitle ?? '',
        item.ipAddress,
        item.clientOrigin ?? '',
        item.sessionId ?? '',
        item.expiresAt ?? '',
      ]
        .map(escapeCsv)
        .join(','),
    )
    const csvContent = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `patientflow-audit-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const renderEventBadge = (type: AuditEventType) => {
    switch (type) {
      case 'LOGIN':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            <LogIn className="h-3 w-3" />
            {t('admin.events.LOGIN')}
          </span>
        )
      case 'LOGOUT':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
            <LogOut className="h-3 w-3" />
            {t('admin.events.LOGOUT')}
          </span>
        )
      case 'CONFIG_CHANGE':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            <Settings2 className="h-3 w-3" />
            {t('admin.events.CONFIG_CHANGE')}
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
            <Eye className="h-3 w-3" />
            {t('admin.events.PAGE_VIEW')}
          </span>
        )
    }
  }

  const hasActiveFilters =
    Boolean(searchInput.trim()) ||
    eventType !== 'ALL' ||
    role !== 'ALL' ||
    pagePath !== 'ALL' ||
    username !== 'ALL' ||
    Boolean(ipAddress.trim()) ||
    timePreset !== 'ALL'

  const stats = statsQuery.data
  const logsPage = logsQuery.data

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* Top KPI Summary Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="gap-2 rounded-2xl border-gray-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t('admin.kpi.totalEvents')}
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Activity className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {stats?.totalEvents ?? 0}
          </div>
          <p className="text-xs text-slate-500">
            {t('admin.kpi.totalStoredSub', { count: retention?.totalStoredLogs ?? 0 })}
          </p>
        </Card>

        <Card className="gap-2 rounded-2xl border-gray-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t('admin.kpi.logins')}
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <UserCheck className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {stats?.loginCount ?? 0}
          </div>
          <p className="text-xs text-slate-500">
            {t('admin.kpi.uniqueUsersSub', { count: stats?.uniqueUsers ?? 0 })}
          </p>
        </Card>

        <Card className="gap-2 rounded-2xl border-gray-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t('admin.kpi.pageViews')}
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Eye className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {stats?.pageViewCount ?? 0}
          </div>
          <p className="truncate text-xs text-slate-500">
            {stats?.topPages?.[0]
              ? t('admin.kpi.topPageSub', { page: stats.topPages[0].pagePath })
              : t('admin.kpi.noPagesSub')}
          </p>
        </Card>

        <Card className="gap-2 rounded-2xl border-gray-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t('admin.kpi.origins')}
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
              <Globe className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {stats?.uniqueIps ?? 0}
          </div>
          <p className="text-xs text-slate-500">{t('admin.kpi.originsSub')}</p>
        </Card>

        <Card className="gap-2 rounded-2xl border-gray-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t('admin.kpi.retentionTtl')}
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-slate-900">
              {t('admin.kpi.ttlDaysValue', { days: retention?.ttlDays ?? 30 })}
            </span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setActiveTab('retention')}
              className="h-7 rounded-lg px-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"
            >
              {t('admin.kpi.configureTtl')}
            </Button>
          </div>
          <p className="truncate text-xs text-slate-500">
            {retention?.tableName ?? 'timescaledb.audit_logs'}
          </p>
        </Card>
      </div>

      {/* Main Workspace Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'logs' | 'retention')}
        className="w-full"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <TabsList className="h-11 rounded-xl bg-slate-100 p-1">
            <TabsTrigger value="logs" className="rounded-lg px-4 py-2 text-sm font-semibold">
              <ShieldCheck className="mr-1.5 h-4 w-4" />
              {t('admin.tabs.logs')}
            </TabsTrigger>
            <TabsTrigger value="retention" className="rounded-lg px-4 py-2 text-sm font-semibold">
              <Clock className="mr-1.5 h-4 w-4" />
              {t('admin.tabs.retention')}
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void logsQuery.refetch()
                void statsQuery.refetch()
              }}
              className="h-10 rounded-xl border-gray-200 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-gray-50"
            >
              <RefreshCw
                className={`mr-1.5 h-4 w-4 ${logsQuery.isFetching ? 'animate-spin' : ''}`}
              />
              {t('admin.actions.refresh')}
            </Button>
            {activeTab === 'logs' && (
              <Button
                type="button"
                variant="outline"
                onClick={handleExportCsv}
                disabled={!logsPage?.items?.length}
                className="h-10 rounded-xl border-gray-200 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-gray-50"
              >
                <Download className="mr-1.5 h-4 w-4" />
                {t('admin.actions.exportCsv')}
              </Button>
            )}
          </div>
        </div>

        {/* TAB 1: AUDIT LOGS EXPLORER */}
        <TabsContent value="logs" className="mt-4 flex flex-col gap-5">
          {/* Search & Filters Card */}
          <Card className="gap-4 rounded-2xl border-gray-200 p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Filter className="h-4 w-4 text-blue-600" />
                {t('admin.filters.title')}
              </div>

              {/* Time Window Quick Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                {(['ALL', '1H', '24H', '7D', '30D', 'CUSTOM'] as TimePreset[]).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setTimePreset(preset)
                      setPage(0)
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                      timePreset === preset
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {t(`admin.filters.timePresets.${preset}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">
              {/* Free-text search */}
              <div className="relative lg:col-span-2">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t('admin.filters.searchPlaceholder')}
                  className="pl-9"
                />
              </div>

              {/* Event Type */}
              <div>
                <Select
                  value={eventType}
                  onChange={(e) => {
                    setEventType(e.target.value)
                    setPage(0)
                  }}
                >
                  <SelectOption value="ALL">{t('admin.filters.allEvents')}</SelectOption>
                  <SelectOption value="LOGIN">{t('admin.events.LOGIN')}</SelectOption>
                  <SelectOption value="PAGE_VIEW">{t('admin.events.PAGE_VIEW')}</SelectOption>
                  <SelectOption value="LOGOUT">{t('admin.events.LOGOUT')}</SelectOption>
                  <SelectOption value="CONFIG_CHANGE">
                    {t('admin.events.CONFIG_CHANGE')}
                  </SelectOption>
                </Select>
              </div>

              {/* Role Filter */}
              <div>
                <Select
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value)
                    setPage(0)
                  }}
                >
                  <SelectOption value="ALL">{t('admin.filters.allRoles')}</SelectOption>
                  <SelectOption value="ADMIN_ROLE">{t('admin.roles.ADMIN_ROLE')}</SelectOption>
                  <SelectOption value="MANAGER_ROLE">{t('admin.roles.MANAGER_ROLE')}</SelectOption>
                </Select>
              </div>

              {/* Page Visited Filter */}
              <div>
                <Select
                  value={pagePath}
                  onChange={(e) => {
                    setPagePath(e.target.value)
                    setPage(0)
                  }}
                >
                  <SelectOption value="ALL">{t('admin.filters.allPages')}</SelectOption>
                  {(stats?.distinctPages ?? []).map((p) => (
                    <SelectOption key={p} value={p}>
                      {p}
                    </SelectOption>
                  ))}
                </Select>
              </div>

              {/* User / Origin IP Filter */}
              <div className="flex gap-2">
                <Select
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    setPage(0)
                  }}
                >
                  <SelectOption value="ALL">{t('admin.filters.allUsers')}</SelectOption>
                  {(stats?.distinctUsers ?? []).map((u) => (
                    <SelectOption key={u} value={u}>
                      {u}
                    </SelectOption>
                  ))}
                </Select>
              </div>
            </div>

            {/* Secondary Filter Row: IP filter + Custom Date Range + Clear Filters */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-56">
                  <Input
                    value={ipAddress}
                    onChange={(e) => {
                      setIpAddress(e.target.value)
                      setPage(0)
                    }}
                    placeholder={t('admin.filters.ipPlaceholder')}
                    className="h-9 text-xs"
                  />
                </div>

                {timePreset === 'CUSTOM' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-500">
                      {t('admin.filters.from')}:
                    </span>
                    <Input
                      type="datetime-local"
                      value={customFrom}
                      onChange={(e) => {
                        setCustomFrom(e.target.value)
                        setPage(0)
                      }}
                      className="h-9 w-48 text-xs"
                    />
                    <span className="text-xs font-medium text-slate-500">
                      {t('admin.filters.to')}:
                    </span>
                    <Input
                      type="datetime-local"
                      value={customTo}
                      onChange={(e) => {
                        setCustomTo(e.target.value)
                        setPage(0)
                      }}
                      className="h-9 w-48 text-xs"
                    />
                  </div>
                )}
              </div>

              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleResetFilters}
                  className="h-8 rounded-lg px-3 text-xs font-semibold text-red-600 hover:bg-red-50"
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  {t('admin.filters.clearAll')}
                </Button>
              )}
            </div>

            {/* Most Visited Pages Quick Strip */}
            {stats?.topPages && stats.topPages.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                <span className="text-xs font-medium text-slate-400">
                  {t('admin.filters.topVisitedPages')}:
                </span>
                {stats.topPages.map((tp) => {
                  const active = pagePath === tp.pagePath
                  return (
                    <button
                      key={tp.pagePath}
                      type="button"
                      onClick={() => {
                        setPagePath(active ? 'ALL' : tp.pagePath)
                        setPage(0)
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-gray-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span className="font-mono">{tp.pagePath}</span>
                      <span className="rounded bg-white px-1.5 py-0.2 text-[11px] font-semibold text-slate-500">
                        {tp.visitCount}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </Card>

          {/* Audit Logs Table Card */}
          <Card className="gap-0 overflow-hidden rounded-2xl border-gray-200 py-0 shadow-xs">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {t('admin.table.title')}
                </h2>
                <p className="text-xs text-slate-500">
                  {t('admin.table.subtitle', {
                    total: logsPage?.totalElements ?? 0,
                    schema: retention?.tableName ?? 'timescaledb.audit_logs',
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{t('admin.table.rowsPerPage')}:</span>
                <Select
                  value={String(size)}
                  onChange={(e) => {
                    setSize(Number(e.target.value))
                    setPage(0)
                  }}
                  className="h-8 w-20 text-xs"
                >
                  <SelectOption value="10">10</SelectOption>
                  <SelectOption value="25">25</SelectOption>
                  <SelectOption value="50">50</SelectOption>
                  <SelectOption value="100">100</SelectOption>
                </Select>
              </div>
            </div>

            <Table>
              <TableHeader className="bg-slate-50/80">
                <TableRow>
                  <TableHead className="px-6 py-3">{t('admin.table.columns.when')}</TableHead>
                  <TableHead className="px-4 py-3">{t('admin.table.columns.event')}</TableHead>
                  <TableHead className="px-4 py-3">{t('admin.table.columns.who')}</TableHead>
                  <TableHead className="px-4 py-3">{t('admin.table.columns.page')}</TableHead>
                  <TableHead className="px-4 py-3">{t('admin.table.columns.where')}</TableHead>
                  <TableHead className="px-4 py-3">{t('admin.table.columns.expires')}</TableHead>
                  <TableHead className="px-6 py-3 text-right">
                    {t('admin.table.columns.details')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsQuery.isPending ? (
                  <TableRow>
                    <TableCell colSpan={7} className="px-6 py-12 text-center text-sm text-slate-500">
                      {t('admin.table.loading')}
                    </TableCell>
                  </TableRow>
                ) : !logsPage?.items?.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="px-6 py-12 text-center text-sm text-slate-500">
                      {t('admin.table.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  logsPage.items.map((item) => (
                    <TableRow key={`${item.id}-${item.occurredAt}`} className="hover:bg-slate-50/80">
                      {/* WHEN */}
                      <TableCell className="px-6 py-3.5">
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-slate-900">
                            {formatDateTime(item.occurredAt, locale)}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {formatRelativeTime(item.occurredAt, t)}
                          </span>
                        </div>
                      </TableCell>

                      {/* EVENT TYPE */}
                      <TableCell className="px-4 py-3.5">
                        {renderEventBadge(item.eventType)}
                      </TableCell>

                      {/* WHO */}
                      <TableCell className="px-4 py-3.5">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setUsername(item.username)
                                setPage(0)
                              }}
                              className="text-left text-xs font-semibold text-slate-900 hover:text-blue-600 hover:underline"
                            >
                              {item.userFullName || item.username}
                            </button>
                            {item.userRoles.map((r) => (
                              <Badge
                                key={r}
                                variant={r === 'ADMIN_ROLE' ? 'default' : 'secondary'}
                                className="px-1.5 py-0 text-[10px]"
                              >
                                {r.replace('_ROLE', '')}
                              </Badge>
                            ))}
                          </div>
                          <span className="text-[11px] text-slate-500">
                            @{item.username}
                            {item.userEmail ? ` · ${item.userEmail}` : ''}
                          </span>
                        </div>
                      </TableCell>

                      {/* WHICH PAGE */}
                      <TableCell className="px-4 py-3.5">
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              setPagePath(item.pagePath)
                              setPage(0)
                            }}
                            className="w-fit rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-medium text-slate-800 hover:bg-blue-50 hover:text-blue-700"
                          >
                            {item.pagePath}
                          </button>
                          {item.pageTitle && (
                            <span className="text-[11px] text-slate-500">{item.pageTitle}</span>
                          )}
                        </div>
                      </TableCell>

                      {/* WHERE (IP + Origin) */}
                      <TableCell className="px-4 py-3.5">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setIpAddress(item.ipAddress)
                                setPage(0)
                              }}
                              className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-0.5 font-mono text-xs font-medium text-slate-800 hover:border-blue-300 hover:text-blue-600"
                              title={t('admin.table.filterByIp')}
                            >
                              <Globe className="h-3 w-3 text-slate-400" />
                              {item.ipAddress}
                            </button>
                          </div>
                          {item.clientOrigin && (
                            <span className="max-w-[230px] truncate text-[11px] text-slate-500">
                              {item.clientOrigin}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* EXPIRES AT */}
                      <TableCell className="px-4 py-3.5">
                        <span className="text-xs text-slate-500">
                          {formatDateTime(item.expiresAt, locale)}
                        </span>
                      </TableCell>

                      {/* INSPECT */}
                      <TableCell className="px-6 py-3.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setSelectedEntry(item)}
                          className="h-8 rounded-lg px-2.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                        >
                          {t('admin.table.inspect')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {/* Pagination Footer */}
            {logsPage && logsPage.totalPages > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 bg-slate-50/50 px-6 py-3.5">
                <span className="text-xs text-slate-500">
                  {t('admin.table.pageSummary', {
                    page: logsPage.page + 1,
                    totalPages: logsPage.totalPages,
                    totalElements: logsPage.totalElements,
                  })}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={logsPage.page <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="h-8 rounded-lg px-3 text-xs"
                  >
                    {t('admin.table.previous')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={logsPage.page + 1 >= logsPage.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="h-8 rounded-lg px-3 text-xs"
                  >
                    {t('admin.table.next')}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* TAB 2: RETENTION & TTL POLICY CONFIGURATION */}
        <TabsContent value="retention" className="mt-4 flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Left 2 Columns: TTL Editor & Presets */}
            <Card className="gap-6 rounded-2xl border-gray-200 p-6 shadow-xs lg:col-span-2">
              <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-5">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {t('admin.retention.title')}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {t('admin.retention.subtitle')}
                  </p>
                </div>
                <Badge variant="secondary" className="px-3 py-1 text-xs">
                  {t('admin.retention.activeBadge', { days: retention?.ttlDays ?? 30 })}
                </Badge>
              </div>

              {/* Preset Selection */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t('admin.retention.quickPresets')}
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  {TTL_PRESETS.map((days) => {
                    const isSelected = candidateTtlDays === days
                    return (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setCustomTtlDays(days)}
                        className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                            : 'border-gray-200 bg-white text-slate-700 hover:bg-gray-50'
                        }`}
                      >
                        {t('admin.retention.daysOption', { days })}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Custom Days Input */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="ttl-days-input"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    {t('admin.retention.customTtlLabel')}
                  </label>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {t('admin.retention.boundsHint', {
                      min: retention?.minTtlDays ?? 1,
                      max: retention?.maxTtlDays ?? 3650,
                    })}
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <Input
                      id="ttl-days-input"
                      type="number"
                      min={retention?.minTtlDays ?? 1}
                      max={retention?.maxTtlDays ?? 3650}
                      value={candidateTtlDays}
                      onChange={(e) => setCustomTtlDays(Number(e.target.value))}
                      className="w-36 text-base font-semibold"
                    />
                    <span className="text-sm font-medium text-slate-600">
                      {t('admin.retention.daysUnit')}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {t('admin.retention.configFileTitle')}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    {t('admin.retention.configFileDesc')}
                  </p>
                  <code className="mt-2 block rounded bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 border border-slate-200">
                    AUDIT_LOG_TTL_DAYS={retention?.defaultTtlDays ?? 30}
                  </code>
                </div>
              </div>

              {/* Live Impact Preview */}
              {previewQuery.data && (
                <div
                  className={`rounded-xl border p-4 ${
                    previewQuery.data.recordsToBeDeleted > 0
                      ? 'border-amber-200 bg-amber-50/70'
                      : 'border-blue-200 bg-blue-50/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle
                      className={`mt-0.5 h-5 w-5 shrink-0 ${
                        previewQuery.data.recordsToBeDeleted > 0
                          ? 'text-amber-600'
                          : 'text-blue-600'
                      }`}
                    />
                    <div className="flex-1 text-sm">
                      <p className="font-semibold text-slate-900">
                        {t('admin.retention.preview.title', {
                          days: previewQuery.data.candidateTtlDays,
                        })}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {t('admin.retention.preview.cutoff', {
                          date: formatDateTime(previewQuery.data.cutoffTimestamp, locale),
                        })}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold">
                        <span className="text-red-700">
                          {t('admin.retention.preview.toDelete', {
                            count: previewQuery.data.recordsToBeDeleted,
                          })}
                        </span>
                        <span className="text-emerald-700">
                          {t('admin.retention.preview.toKeep', {
                            count: previewQuery.data.recordsRemaining,
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={cleanupNowMutation.isPending}
                  onClick={() => cleanupNowMutation.mutate()}
                  className="h-10 rounded-xl border-gray-200 px-4 text-sm font-medium text-slate-700 hover:bg-gray-50"
                >
                  <Trash2 className="mr-1.5 h-4 w-4 text-slate-500" />
                  {t('admin.retention.runCleanupNow')}
                </Button>

                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={candidateTtlDays === retention?.ttlDays}
                    onClick={() => setCustomTtlDays(null)}
                    className="h-10 rounded-xl px-4 text-sm"
                  >
                    {t('admin.retention.resetButton')}
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      !Number.isFinite(candidateTtlDays) ||
                      candidateTtlDays < (retention?.minTtlDays ?? 1) ||
                      candidateTtlDays > (retention?.maxTtlDays ?? 3650)
                    }
                    onClick={() => {
                      setDoubleCheckAccepted(false)
                      setConfirmStep(1)
                    }}
                    className="h-10 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    {t('admin.retention.saveButton')}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Right Column: TimescaleDB Storage & Policy Metadata */}
            <Card className="gap-4 rounded-2xl border-gray-200 p-6 shadow-xs">
              <div className="flex items-center gap-2.5 border-b border-gray-100 pb-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Database className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {t('admin.retention.storageTitle')}
                  </h3>
                  <p className="text-xs text-slate-500">{t('admin.retention.storageSubtitle')}</p>
                </div>
              </div>

              <dl className="flex flex-col gap-3.5 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-slate-500">{t('admin.retention.meta.schema')}</dt>
                  <dd className="font-mono text-xs font-semibold text-slate-900">
                    {retention?.schemaName ?? 'timescaledb'}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-slate-500">{t('admin.retention.meta.table')}</dt>
                  <dd className="font-mono text-xs font-semibold text-slate-900">
                    {retention?.tableName ?? 'timescaledb.audit_logs'}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-slate-500">{t('admin.retention.meta.engine')}</dt>
                  <dd>
                    <Badge variant="secondary" className="text-[11px]">
                      {retention?.timescaleEnabled
                        ? 'TimescaleDB Hypertable'
                        : 'PostgreSQL Timescale Schema'}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-slate-500">{t('admin.retention.meta.totalRows')}</dt>
                  <dd className="text-xs font-bold text-slate-900">
                    {retention?.totalStoredLogs ?? 0}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-slate-500">{t('admin.retention.meta.oldestEntry')}</dt>
                  <dd className="text-xs text-slate-700">
                    {formatDateTime(retention?.oldestLogAt, locale)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-slate-500">{t('admin.retention.meta.newestEntry')}</dt>
                  <dd className="text-xs text-slate-700">
                    {formatDateTime(retention?.newestLogAt, locale)}
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                  <dt className="text-xs text-slate-500">{t('admin.retention.meta.updatedBy')}</dt>
                  <dd className="text-xs font-medium text-slate-800">
                    {retention?.updatedByName || retention?.updatedBy || 'SYSTEM'}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-slate-500">{t('admin.retention.meta.updatedAt')}</dt>
                  <dd className="text-xs text-slate-700">
                    {formatDateTime(retention?.updatedAt, locale)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-slate-500">{t('admin.retention.meta.lastCleanup')}</dt>
                  <dd className="text-xs text-slate-700">
                    {formatDateTime(retention?.lastCleanupAt, locale)}
                  </dd>
                </div>
              </dl>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* INSPECT AUDIT ENTRY MODAL */}
      {selectedEntry && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelectedEntry(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 pb-4">
              <div className="flex items-center gap-3">
                {renderEventBadge(selectedEntry.eventType)}
                <h3 className="text-lg font-semibold text-slate-900">
                  {t('admin.detailModal.title')}
                </h3>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSelectedEntry(null)}
                className="h-8 w-8 rounded-lg p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs font-medium text-slate-400">
                  {t('admin.detailModal.occurredAt')}
                </dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {formatDateTime(selectedEntry.occurredAt, locale)}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs font-medium text-slate-400">
                  {t('admin.detailModal.expiresAt')}
                </dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {formatDateTime(selectedEntry.expiresAt, locale)}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs font-medium text-slate-400">
                  {t('admin.detailModal.user')}
                </dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {selectedEntry.userFullName || selectedEntry.username} (@
                  {selectedEntry.username})
                </dd>
                <dd className="text-xs text-slate-500">{selectedEntry.userEmail || '—'}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs font-medium text-slate-400">
                  {t('admin.detailModal.page')}
                </dt>
                <dd className="mt-1 font-mono text-xs font-semibold text-slate-900">
                  {selectedEntry.pagePath}
                </dd>
                <dd className="text-xs text-slate-500">{selectedEntry.pageTitle || '—'}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs font-medium text-slate-400">
                  {t('admin.detailModal.ipAndOrigin')}
                </dt>
                <dd className="mt-1 font-mono text-xs font-semibold text-slate-900">
                  {selectedEntry.ipAddress}
                </dd>
                <dd className="text-xs text-slate-500">{selectedEntry.clientOrigin || '—'}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs font-medium text-slate-400">
                  {t('admin.detailModal.sessionAndSub')}
                </dt>
                <dd className="mt-1 truncate font-mono text-xs text-slate-800">
                  SID: {selectedEntry.sessionId || '—'}
                </dd>
                <dd className="truncate font-mono text-[11px] text-slate-500">
                  SUB: {selectedEntry.userId}
                </dd>
              </div>
            </dl>

            <div className="mt-4 rounded-xl bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <Monitor className="h-3.5 w-3.5" />
                {t('admin.detailModal.userAgent')}
              </div>
              <p className="mt-1 break-all font-mono text-xs text-slate-700">
                {selectedEntry.userAgent || '—'}
              </p>
            </div>

            {selectedEntry.details && Object.keys(selectedEntry.details).length > 0 && (
              <div className="mt-4 rounded-xl bg-slate-900 p-3.5 text-slate-100">
                <div className="text-xs font-semibold text-slate-400">
                  {t('admin.detailModal.metadata')}
                </div>
                <pre className="mt-1.5 max-h-40 overflow-auto font-mono text-xs">
                  {JSON.stringify(selectedEntry.details, null, 2)}
                </pre>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelectedEntry(null)}
                className="rounded-xl px-5"
              >
                {t('admin.detailModal.close')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* TWO-STEP DOUBLE-CHECK ("ARE YOU SURE?") MODAL FOR CHANGING TTL */}
      {confirmStep > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!updateTtlMutation.isPending) {
              setConfirmStep(0)
              setDoubleCheckAccepted(false)
            }
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-7 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {confirmStep === 1 ? (
              /* STEP 1: REVIEW TTL CHANGE & IMPACT */
              <div>
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                  <Calendar className="h-8 w-8" />
                </div>
                <h2 className="text-center text-xl font-bold text-slate-900">
                  {t('admin.retention.confirmStep1.title')}
                </h2>
                <p className="mt-2 text-center text-sm text-slate-500">
                  {t('admin.retention.confirmStep1.description')}
                </p>

                <div className="mt-6 grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-slate-50 p-4 text-center">
                  <div>
                    <div className="text-xs font-medium text-slate-400">
                      {t('admin.retention.confirmStep1.currentTtl')}
                    </div>
                    <div className="mt-1 text-xl font-bold text-slate-700">
                      {t('admin.retention.daysOption', { days: retention?.ttlDays ?? 30 })}
                    </div>
                  </div>
                  <div className="border-l border-gray-200">
                    <div className="text-xs font-medium text-blue-600">
                      {t('admin.retention.confirmStep1.newTtl')}
                    </div>
                    <div className="mt-1 text-xl font-bold text-blue-600">
                      {t('admin.retention.daysOption', { days: validCandidateTtl })}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-slate-700">
                  <p className="font-semibold text-amber-900">
                    {t('admin.retention.confirmStep1.impactNote', {
                      deleted: previewQuery.data?.recordsToBeDeleted ?? 0,
                      remaining: previewQuery.data?.recordsRemaining ?? 0,
                    })}
                  </p>
                </div>

                <div className="mt-7 flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmStep(0)}
                    className="h-12 flex-1 rounded-xl"
                  >
                    {t('admin.retention.confirmStep1.cancel')}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setConfirmStep(2)}
                    className="h-12 flex-1 rounded-xl bg-amber-600 font-semibold text-white hover:bg-amber-700"
                  >
                    {t('admin.retention.confirmStep1.proceed')}
                  </Button>
                </div>
              </div>
            ) : (
              /* STEP 2: "ARE YOU SURE?" FINAL DOUBLE-CHECK VIEW */
              <div>
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <ShieldAlert className="h-8 w-8" />
                </div>
                <h2 className="text-center text-xl font-bold text-slate-900">
                  {t('admin.retention.confirmStep2.title')}
                </h2>
                <p className="mt-2 text-center text-sm text-slate-600">
                  {t('admin.retention.confirmStep2.description', {
                    days: validCandidateTtl,
                    deleted: previewQuery.data?.recordsToBeDeleted ?? 0,
                  })}
                </p>

                <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-red-200 bg-red-50/50 p-4 text-xs text-slate-800">
                  <input
                    type="checkbox"
                    checked={doubleCheckAccepted}
                    onChange={(e) => setDoubleCheckAccepted(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <span className="font-medium leading-relaxed">
                    {t('admin.retention.confirmStep2.checkboxLabel', {
                      days: validCandidateTtl,
                    })}
                  </span>
                </label>

                <div className="mt-7 flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={updateTtlMutation.isPending}
                    onClick={() => setConfirmStep(1)}
                    className="h-12 flex-1 rounded-xl"
                  >
                    {t('admin.retention.confirmStep2.back')}
                  </Button>
                  <Button
                    type="button"
                    disabled={!doubleCheckAccepted || updateTtlMutation.isPending}
                    onClick={() =>
                      updateTtlMutation.mutate({
                        ttlDays: validCandidateTtl,
                        confirmed: true,
                      })
                    }
                    className="h-12 flex-1 rounded-xl bg-red-600 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    {updateTtlMutation.isPending
                      ? t('admin.retention.confirmStep2.applying')
                      : t('admin.retention.confirmStep2.confirmFinal')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {popup && (
        <OperationPopup
          key={popup.key}
          type={popup.type}
          title={popup.title}
          description={popup.description}
        />
      )}
    </div>
  )
}

export default Admin
