import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router'
import { useKeycloak, type AccessScopeType } from '../auth/context'
import { recordAuditEvent } from '@/api/audit'
import { fetchHierarchyNode } from '@/features/lhu-hierarchy/api/hierarchy'
import type { Level } from '@/pages/space/types'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

const PAGES = [
  '/dashboard',
  '/manager-hierarchy',
  '/hierarchy',
  '/admin',
  '/account',
  '/settings',
  '/lhu-hierarchy',
] as const

const SCOPE_LEVELS: Record<AccessScopeType, Level> = {
  ULS: 'lhu',
  UNIT: 'unit',
  BUILDING: 'building',
  FLOOR: 'floor',
  SERVICE: 'service',
  WING: 'wing',
  WARD: 'ward',
}

const AppLayout = () => {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const { user } = useKeycloak()
  const [selectedRootId, setSelectedRootId] = useState<string>()
  const page = PAGES.find((p) => pathname === p || pathname.startsWith(`${p}/`))?.slice(1) ?? 'default'
  const isManagerRoute =
    (page === 'manager-hierarchy' || page === 'dashboard') &&
    user?.roles.includes('MANAGER_ROLE') === true
  const hierarchyScope = user?.scopeType ?? 'unassigned'
  const startLevel = (user?.scopeType && SCOPE_LEVELS[user.scopeType]) || 'lhu'
  const assignedScopes = user?.scopes.filter((scope) => scope.type === user.scopeType) ?? []
  const {
    data: roots,
    isPending: hierarchyRootsPending,
    isError: rootsError,
  } = useQuery({
    queryKey: [
      'manager-hierarchy-roots',
      user?.scopeType,
      assignedScopes.map((scope) => scope.scopeId),
    ],
    queryFn: () =>
      Promise.all(
        assignedScopes.map((scope) => fetchHierarchyNode(startLevel, scope.scopeId)),
      ),
    enabled: isManagerRoute && assignedScopes.length > 0,
  })
  const activeRoot =
    roots?.find((root) => root.id === selectedRootId) ?? roots?.[0]
  const pageName = page === 'manager-hierarchy' && isManagerRoute
    ? t(`pages.hierarchy.scopes.${hierarchyScope}.title`)
    : t(`pages.${page}.title`)
  const pageDescription = page === 'manager-hierarchy' && isManagerRoute
    ? t(`pages.hierarchy.scopes.${hierarchyScope}.description`)
    : t(`pages.${page}.description`)
  const lastLoggedPageRef = useRef<{ path: string; ts: number } | null>(null)

  useEffect(() => {
    if (!user) return
    const now = Date.now()
    const prev = lastLoggedPageRef.current
    if (prev && prev.path === pathname && now - prev.ts < 1500) {
      return
    }
    lastLoggedPageRef.current = { path: pathname, ts: now }
    void recordAuditEvent({
      eventType: 'PAGE_VIEW',
      pagePath: pathname,
      pageTitle: pageName,
    })
  }, [pathname, pageName, user])
  const scopeFilter = activeRoot
    ? {
        ulsId: activeRoot.type === 'lhu' ? activeRoot.id : undefined,
        unitId: activeRoot.type === 'unit' ? activeRoot.id : undefined,
        buildingId: activeRoot.type === 'building' ? activeRoot.id : undefined,
        floorId: activeRoot.type === 'floor' ? activeRoot.id : undefined,
        serviceId: activeRoot.type === 'service' ? activeRoot.id : undefined,
        wingId: activeRoot.type === 'wing' ? activeRoot.id : undefined,
        wardId: activeRoot.type === 'ward' ? activeRoot.id : undefined,
      }
    : {}

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white font-sans">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar pageName={pageName} pageDescription={pageDescription} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-[#fafafa] px-9 py-6">
          <Outlet
            context={{
              managerScope: {
                startLevel,
                scopes: roots ?? [],
                root: activeRoot,
                scope: scopeFilter,
                isPending: isManagerRoute && assignedScopes.length > 0 && hierarchyRootsPending,
                isError: isManagerRoute && rootsError,
                hasMultipleScopes: assignedScopes.length > 1,
                selectScope: setSelectedRootId,
              },
            }}
          />
        </main>
      </div>
    </div>
  )
}

export default AppLayout
