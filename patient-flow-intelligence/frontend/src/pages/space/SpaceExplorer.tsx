import { useEffect, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { fetchLHUHierarchy } from '@/features/lhu-hierarchy/api/hierarchy'
import SpaceNavigation from './SpaceNavigation'
import { LEVELS, type Level, type Open, type SpaceNode, type ViewProps } from './types'

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
  bed: BedView
}

interface SpaceExplorerProps {
  /** Highest level the user may see: LHU manager 'lhu', unit manager 'unit', service manager 'service' */
  startLevel?: Level
  /** Level that is open on first render (defaults to startLevel) */
  initialLevel?: Level
}

const SpaceExplorer = ({ startLevel = 'lhu', initialLevel }: SpaceExplorerProps) => {
  const { t } = useTranslation()
  const { data: hierarchy, isPending, isError } = useQuery({
    queryKey: ['space-hierarchy'],
    queryFn: fetchLHUHierarchy,
  })
  const startIndex = LEVELS.indexOf(startLevel)
  const initialIndex = Math.max(LEVELS.indexOf(initialLevel ?? startLevel), startIndex)

  const tree = hierarchy?.map(toSpaceNode) ?? []
  const initialPath = hierarchy ? pathToLevel(tree, initialIndex, startLevel) : []
  const [path, setPath] = useState<SpaceNode[]>(initialPath)

  useEffect(() => {
    if (initialPath.length) setPath(initialPath)
  }, [hierarchy, initialIndex])

  if (isPending) return <div>Loading...</div>
  if (isError || !path.length) return <div>{t('lhuHierarchy.error')}</div>

  const current = path[path.length - 1]
  const crumbs = path

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

function toSpaceNode(node: Awaited<ReturnType<typeof fetchLHUHierarchy>>[number]): SpaceNode {
  if (node.type === 'operating-room' || node.type === 'treatment-chair') {
    throw new Error(`Unsupported hierarchy type: ${node.type}`)
  }

  return {
    id: node.id,
    level: node.type,
    name: node.name,
    children: node.children?.map(toSpaceNode),
  }
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
