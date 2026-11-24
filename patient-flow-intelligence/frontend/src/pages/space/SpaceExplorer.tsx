import { useEffect, useState, useMemo, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { hasAdminRole, useKeycloak } from '@/auth/context'
import {
  fetchHierarchyChildren,
  fetchHierarchyLevel,
  fetchHierarchyNode,
  hierarchyChildrenQueryKey,
} from '@/features/lhu-hierarchy/api/hierarchy'
import { fetchBedMap, fetchBeds, fetchEncounter, fetchPatient } from '@/api/operational'
import type { OrgType } from '@/features/lhu-hierarchy/types/tree'
import { AdminHierarchyOverview } from '@/features/lhu-hierarchy/components/AdminHierarchyOverview'
import SpaceNavigation from './SpaceNavigation'
import { LEVELS, type Level, type Open, type SpaceNode, type ViewProps, type Resource } from './types'

import LhuView from './views/LhuView'
import UnitView from './views/UnitView'
import BuildingView from './views/BuildingView'
import FloorView from './views/FloorView'
import ServiceView from './views/ServiceView'
import WingView from './views/WingView'
import WardView from './views/WardView'
import RoomView from './views/RoomView'
import BedView from './views/BedView'

// One view per level of the hierarchy
const VIEWS: Record<Level, ComponentType<ViewProps>> = {
  lhu: LhuView,
  unit: UnitView,
  building: BuildingView,
  floor: FloorView,
  service: ServiceView,
  wing: WingView,
  ward: WardView,
  room: RoomView,
  bed: BedView,
}

interface SpaceExplorerProps {
  /** Highest level the user may see */
  startLevel?: Level
  /** Restricts the starting list to one assigned root */
  rootId?: string
  /** Level that is open on first render (defaults to startLevel) */
  initialLevel?: Level
  adminMode?: boolean
  onAddChild?: (parentPath: SpaceNode[], types: OrgType[]) => void
}

/** Converte o estado da cama do backend para o estado interno da UI */
function bedStatusToUi(status: string): string {
  switch (status) {
    case 'OCCUPIED':
      return 'occupied'
    case 'AVAILABLE':
      return 'available'
    case 'BLOCKED':
      return 'reserved'
    case 'RESERVED':
      return 'reserved'
    case 'CLEANING':
      return 'reserved'
    default:
      return 'available'
  }
}

function calculateAge(birthDate: string | null): number | undefined {
  if (!birthDate) return undefined
  const birth = new Date(`${birthDate}T00:00:00`)
  if (Number.isNaN(birth.getTime())) return undefined
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const birthdayHasPassed =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate())
  if (!birthdayHasPassed) age -= 1
  return age >= 0 ? age : undefined
}

const SpaceExplorer = ({
  startLevel = 'lhu',
  rootId,
  initialLevel,
  adminMode = false,
  onAddChild,
}: SpaceExplorerProps) => {
  const { t } = useTranslation()
  const { user } = useKeycloak()
  const hasApplicationRole = user?.roles.includes('MANAGER_ROLE') === true || hasAdminRole(user?.roles)
  const [selectedRoomId, setSelectedRoomId] = useState<string>()

  // 1. Hierarquia real (ULS → unidade → edifício → piso → serviço → enfermaria → sala → cama)
  const {
    data: hierarchy,
    isPending,
    isError,
  } = useQuery({
    queryKey: ['space-hierarchy', startLevel, rootId],
    queryFn: async () => {
      if (rootId) return [await fetchHierarchyNode(startLevel, rootId)]
      const nodes = await fetchHierarchyLevel(startLevel)
      return nodes
    },
    enabled: hasApplicationRole,
  })

  // Camas detalhadas só são carregadas dentro de um quarto.
  const { data: bedsData } = useQuery({
    queryKey: ['beds-operational', selectedRoomId],
    queryFn: () => fetchBeds({ roomId: selectedRoomId }, undefined, 0, 50),
    enabled: hasApplicationRole && !adminMode && Boolean(selectedRoomId),
    refetchInterval: 60_000,
  })

  const occupiedBeds = useMemo(
    () =>
      (bedsData?.content ?? []).filter(
        (bed) => bed.status === 'OCCUPIED' && bed.patientId,
      ),
    [bedsData],
  )

  const {
    data: patientDetails,
    isPending: patientDetailsPending,
    isError: patientDetailsError,
  } = useQuery({
    queryKey: [
      'room-patient-details',
      selectedRoomId,
      occupiedBeds.map((bed) => `${bed.patientId}:${bed.encounterId}`).join(','),
    ],
    queryFn: async () => {
      const details = await Promise.all(
        occupiedBeds.map(async (bed) => {
          const patient = await fetchPatient(bed.patientId as string)
          const encounter = bed.encounterId
            ? await fetchEncounter(bed.encounterId)
            : undefined
          return { bedId: bed.id, patient, encounter }
        }),
      )
      return new Map(
        details.map((detail) => [
          detail.bedId,
          { patient: detail.patient, encounter: detail.encounter },
        ]),
      )
    },
    enabled: hasApplicationRole && !adminMode && Boolean(selectedRoomId && occupiedBeds.length),
    refetchInterval: 60_000,
  })

  // Camas agrupadas por roomId para enriquecimento da árvore de espaços.
  const bedsByRoom = useMemo(() => {
    const map = new Map<string, Resource[]>()
    if (!bedsData?.content) return map

    for (const bed of bedsData.content) {
      if (!bed.roomId) continue
      const uiStatus = bedStatusToUi(bed.status)
      const details = patientDetails?.get(bed.id)
      const patient = details?.patient
      const encounter = details?.encounter
      const resource: Resource = {
        id: bed.id,
        code: bed.code,
        type: 'bed',
        number: 0, // Será atribuído abaixo após ordenação
        status: uiStatus,
        location: [bed.wardCode, bed.roomCode].filter(Boolean).join(' · ') || undefined,
        occupant:
          uiStatus === 'occupied' && (bed.patientId || bed.patientName)
            ? {
                name: patient?.fullName ?? bed.patientName ?? 'Unknown',
                id: bed.patientId ?? undefined,
                snsNumber: patient?.snsNumber,
                hospitalNumber: patient?.hospitalNumber ?? undefined,
                birthDate: patient?.birthDate ?? bed.patientBirthDate ?? undefined,
                gender: patient?.gender,
                age: calculateAge(patient?.birthDate ?? bed.patientBirthDate),
                diagnosis: '',
                admitted: encounter?.admittedAt ?? bed.admittedAt ?? undefined,
                expectedDischargeAt:
                  encounter?.expectedDischargeAt ?? bed.expectedDischargeAt ?? undefined,
                serviceName: encounter?.serviceName ?? bed.serviceName,
                wardCode: bed.wardCode,
              }
            : undefined,
      }
      const list = map.get(bed.roomId) ?? []
      list.push(resource)
      map.set(bed.roomId, list)
    }

    // Numera as camas dentro de cada sala (por código de cama, lexicograficamente)
    for (const [roomId, beds] of map) {
      beds.forEach((b, i) => {
        b.number = i + 1
      })
      map.set(roomId, beds)
    }

    return map
  }, [bedsData, patientDetails])

  // 4. Constrói a árvore de espaços enriquecida com dados operacionais
  const tree = useMemo(
    () =>
      hierarchy
        ? hierarchy.map((n) =>
            toSpaceNode(n, bedsByRoom),
          )
        : [],
    [hierarchy, bedsByRoom],
  )

  const startIndex = LEVELS.indexOf(startLevel)
  const initialIndex = Math.max(LEVELS.indexOf(initialLevel ?? startLevel), startIndex)
  const initialPath = hierarchy ? pathToLevel(tree, initialIndex, startLevel) : []
  const [path, setPath] = useState<SpaceNode[]>(initialPath)
  const [loadedTree, setLoadedTree] = useState<SpaceNode[]>([])

  useEffect(() => {
    if (initialPath.length) {
      const rootId = initialPath[0].id
      setLoadedTree((previous) =>
        previous.length && previous[0].id === rootId ? previous : tree,
      )
      setPath((previous) =>
        previous.length && previous[0].id === rootId ? previous : initialPath,
      )
    }
  }, [hierarchy, initialIndex])

  const current = path[path.length - 1]
  useEffect(() => {
    if (current?.level === 'room') {
      setSelectedRoomId(current.id)
    }
  }, [current?.id, current?.level])

  const currentSummaryScope =
    current?.level === 'lhu'
      ? { ulsId: current.id }
      : current?.level === 'unit'
        ? { unitId: current.id }
        : current?.level === 'building'
          ? { buildingId: current.id }
          : current?.level === 'floor'
            ? { floorId: current.id }
        : current?.level === 'service'
              ? { serviceId: current.id }
              : current?.level === 'wing'
                ? { wingId: current.id }
                : current?.level === 'ward'
                  ? { wardId: current.id }
                  : current?.level === 'room'
                    ? { roomId: current.id }
                    : {}
  const { data: currentBedSummary } = useQuery({
    queryKey: ['space-bed-summary-current', current?.level, current?.id],
    queryFn: () => fetchBedMap(currentSummaryScope, undefined, 0, 1),
    enabled: hasApplicationRole && !adminMode && Boolean(
      current && ['lhu', 'unit', 'building', 'floor', 'service', 'wing', 'ward', 'room'].includes(current.level),
    ),
  })

  const currentOrgNode = current
    ? {
        id: current.id,
        name: current.name,
        type: current.level,
        parentId: null,
        status: 'operational',
      }
    : undefined
  const childrenQuery = useQuery({
    queryKey: currentOrgNode
      ? hierarchyChildrenQueryKey(currentOrgNode)
      : ['space-hierarchy-children', 'none'],
    queryFn: () => {
      if (!currentOrgNode) throw new Error('Cannot load children without a selected hierarchy node')
      return fetchHierarchyChildren(currentOrgNode)
    },
    enabled: hasApplicationRole && Boolean(currentOrgNode && current?.level !== 'bed' && !current?.children),
    staleTime: 30_000,
  })
  const loadingChildren = childrenQuery.isPending && childrenQuery.isFetching
  const childrenError = childrenQuery.isError

  if (isPending) return <div>Loading...</div>
  if (isError) return <div>{t('lhuHierarchy.error')}</div>
  if (!hierarchy?.length || !path.length) return <div>{t('lhuHierarchy.noData')}</div>

  // Re-sincroniza os nós do caminho atual com a árvore enriquecida (para refletir dados operacionais atualizados)
  const syncedPath = path.map((p) => {
    const node = findNode(loadedTree, p.id) ?? p
    return node.level === 'room'
      ? { ...node, resources: bedsByRoom.get(node.id) ?? node.resources }
      : node.level === 'bed'
        ? {
            ...node,
            resources: findResource(bedsByRoom, node.id)
              ? [findResource(bedsByRoom, node.id)!]
              : node.resources,
          }
      : node
  })
  const syncedCurrent = {
    ...syncedPath[syncedPath.length - 1],
    ...(childrenQuery.data && !syncedPath[syncedPath.length - 1].children
      ? { children: childrenQuery.data.map((child) => toSpaceNode(child, bedsByRoom)) }
      : {}),
    bedCounts: currentBedSummary
      ? bedCountsFromMap(currentBedSummary.counts)
      : syncedPath[syncedPath.length - 1].bedCounts,
  }
  const crumbs = syncedPath

  const open: Open = (...nodes) => setPath((p) => [...p, ...nodes])
  const goTo = (index: number) => setPath((p) => p.slice(0, index + 1))

  const View = VIEWS[syncedCurrent.level]

  if (adminMode) {
    return (
      <div className="flex flex-col gap-5">
        <SpaceNavigation crumbs={crumbs} onSelect={goTo} />
        {loadingChildren && <div className="text-sm text-gray-500">Loading...</div>}
        {childrenError && <div className="text-sm text-red-600">{t('lhuHierarchy.error')}</div>}
        <AdminHierarchyOverview
          node={syncedCurrent}
          path={syncedPath}
          loadingChildren={loadingChildren}
          onOpen={open}
          onBack={() => {
            if (path.length > 1) goTo(path.length - 2)
          }}
          onAddChild={onAddChild}
          onRename={(name) => {
            setPath((previous) =>
              previous.map((item) =>
                item.id === syncedCurrent.id ? { ...item, name } : item,
              ),
            )
            setLoadedTree((previous) =>
              previous.map((item) =>
                item.id === syncedCurrent.id ? { ...item, name } : item,
              ),
            )
          }}
          onDelete={() => {
            if (path.length > 1) goTo(path.length - 2)
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <SpaceNavigation crumbs={crumbs} onSelect={goTo} />
      {loadingChildren && <div className="text-sm text-gray-500">Loading...</div>}
      {patientDetailsPending && current?.level === 'room' && (
        <div className="text-sm text-gray-500">A carregar informação do paciente...</div>
      )}
      {patientDetailsError && current?.level === 'room' && (
        <div className="text-sm text-red-600">
          Não foi possível carregar a informação completa do paciente.
        </div>
      )}
      {childrenError && <div className="text-sm text-red-600">{t('lhuHierarchy.error')}</div>}
      {/* key resets the view state (for example the room search) when the node changes */}
      <View key={syncedCurrent.id} node={syncedCurrent} open={open} />
    </div>
  )
}

/** Converte um nó da hierarquia OrgNode num SpaceNode, injetando camas reais nas salas */
function toSpaceNode(
  node: Awaited<ReturnType<typeof fetchHierarchyLevel>>[number],
  bedsByRoom: Map<string, Resource[]>,
  bedCounts?: SpaceNode['bedCounts'],
): SpaceNode {
  const spaceNode: SpaceNode = {
    id: node.id,
    level: node.type,
    name: node.name,
    children: node.children?.map((c) => toSpaceNode(c, bedsByRoom)),
    bedCounts,
  }

  // Injeta as camas reais no nó de tipo 'room'
  if (node.type === 'room') {
    const beds = bedsByRoom.get(node.id)
    if (beds?.length) {
      spaceNode.resources = beds
    }
  }

  return spaceNode
}

function bedCountsFromMap(counts: Record<string, number>): NonNullable<SpaceNode['bedCounts']> {
  const occupied = counts.OCCUPIED ?? 0
  const available = counts.AVAILABLE ?? 0
  const reserved = (counts.BLOCKED ?? 0) + (counts.CLEANING ?? 0)
  return { total: occupied + available + reserved, occupied, available, reserved }
}

/** Pesquisa recursiva de um nó pelo ID */
function findNode(tree: SpaceNode[], id: string): SpaceNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return undefined
}

function findResource(
  resourcesByRoom: Map<string, Resource[]>,
  id: string,
): Resource | undefined {
  for (const resources of resourcesByRoom.values()) {
    const resource = resources.find((candidate) => candidate.id === id)
    if (resource) return resource
  }
  return undefined
}

function pathToLevel(tree: SpaceNode[], depth: number, startLevel: Level): SpaceNode[] {
  const path: SpaceNode[] = []
  let current = tree.find((node) => node.level === startLevel) ?? tree[0]
  const relativeDepth = current?.level === startLevel ? depth - LEVELS.indexOf(startLevel) : depth
  while (current) {
    path.push(current)
    if (path.length - 1 >= relativeDepth) break
    current = current.children?.[0] as SpaceNode
  }
  return path
}

export default SpaceExplorer
