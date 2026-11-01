import { useEffect, useState, useMemo, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { fetchLHUHierarchy } from '@/features/lhu-hierarchy/api/hierarchy'
import { fetchBeds } from '@/api/operational'
import SpaceNavigation from './SpaceNavigation'
import { LEVELS, type Level, type Open, type SpaceNode, type ViewProps, type Resource } from './types'

import LhuView from './views/LhuView'
import UnitView from './views/UnitView'
import BuildingView from './views/BuildingView'
import FloorView from './views/FloorView'
import ServiceView from './views/ServiceView'
import WardView from './views/WardView'
import NurseryView from './views/NurseryView'
import RoomView from './views/RoomView'
import BedView from './views/BedView'

// One view per level of the hierarchy
const VIEWS: Record<Level, ComponentType<ViewProps>> = {
  lhu: LhuView,
  unit: UnitView,
  building: BuildingView,
  floor: FloorView,
  service: ServiceView,
  ward: WardView,
  nursery: NurseryView,
  room: RoomView,
  bed: BedView,
}

interface SpaceExplorerProps {
  /** Highest level the user may see: LHU manager 'lhu', unit manager 'unit', service manager 'service' */
  startLevel?: Level
  /** Level that is open on first render (defaults to startLevel) */
  initialLevel?: Level
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

const SpaceExplorer = ({ startLevel = 'lhu', initialLevel }: SpaceExplorerProps) => {
  const { t } = useTranslation()

  // 1. Hierarquia real (ULS → unidade → edifício → piso → serviço → enfermaria → sala → cama)
  const {
    data: hierarchy,
    isPending,
    isError,
  } = useQuery({
    queryKey: ['space-hierarchy'],
    queryFn: fetchLHUHierarchy,
  })

  // 2. Dados operacionais de camas (estado + doente atual)
  const { data: bedsData } = useQuery({
    queryKey: ['beds-operational'],
    queryFn: () => fetchBeds({}, undefined, 0, 20),
    refetchInterval: 60_000, // Atualiza automaticamente a cada minuto
  })

  // 3. Camas agrupadas por roomId para enriquecimento da árvore de espaços
  const bedsByRoom = useMemo(() => {
    const map = new Map<string, Resource[]>()
    if (!bedsData?.content) return map

    for (const bed of bedsData.content) {
      if (!bed.roomId) continue
      const uiStatus = bedStatusToUi(bed.status)
      const resource: Resource = {
        id: bed.id,
        type: 'bed',
        number: 0, // Será atribuído abaixo após ordenação
        status: uiStatus,
        occupant:
          uiStatus === 'occupied' && bed.patientName
            ? {
                name: bed.patientName,
                age: 0,        // não disponível no BedView
                diagnosis: '', // não disponível no BedView
                admitted: '',  // não disponível no BedView
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
  }, [bedsData])

  // 4. Constrói a árvore de espaços enriquecida com dados operacionais
  const tree = useMemo(
    () => (hierarchy ? hierarchy.map((n) => toSpaceNode(n, bedsByRoom)) : []),
    [hierarchy, bedsByRoom],
  )

  const startIndex = LEVELS.indexOf(startLevel)
  const initialIndex = Math.max(LEVELS.indexOf(initialLevel ?? startLevel), startIndex)
  const initialPath = hierarchy ? pathToLevel(tree, initialIndex, startLevel) : []
  const [path, setPath] = useState<SpaceNode[]>(initialPath)

  useEffect(() => {
    if (initialPath.length) setPath(initialPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hierarchy, initialIndex, bedsByRoom])

  if (isPending) return <div>Loading...</div>
  if (isError || !path.length) return <div>{t('lhuHierarchy.error')}</div>

  // Re-sincroniza os nós do caminho atual com a árvore enriquecida (para refletir dados operacionais atualizados)
  const syncedPath = path.map((p) => findNode(tree, p.id) ?? p)
  const current = syncedPath[syncedPath.length - 1]
  const crumbs = syncedPath

  const open: Open = (...nodes) => setPath((p) => [...p, ...nodes])
  const goTo = (index: number) => setPath((p) => p.slice(0, index + 1))

  const View = VIEWS[current.level]

  return (
    <div className="flex flex-col gap-5">
      <SpaceNavigation crumbs={crumbs} onSelect={goTo} />
      {/* key resets the view state (for example the room search) when the node changes */}
      <View key={current.id} node={current} open={open} />
    </div>
  )
}

/** Converte um nó da hierarquia OrgNode num SpaceNode, injetando camas reais nas salas */
function toSpaceNode(
  node: Awaited<ReturnType<typeof fetchLHUHierarchy>>[number],
  bedsByRoom: Map<string, Resource[]>,
): SpaceNode {
  if (node.type === 'operating-room' || node.type === 'treatment-chair') {
    throw new Error(`Unsupported hierarchy type: ${node.type}`)
  }

  const spaceNode: SpaceNode = {
    id: node.id,
    level: node.type,
    name: node.name,
    children: node.children?.map((c) => toSpaceNode(c, bedsByRoom)),
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
