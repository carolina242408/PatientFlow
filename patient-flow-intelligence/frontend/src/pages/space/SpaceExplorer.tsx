import { useState, type ComponentType } from 'react'
import SpaceNavigation from './SpaceNavigation'
import { pathTo } from './data'
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
  const startIndex = LEVELS.indexOf(startLevel)
  const initialIndex = Math.max(LEVELS.indexOf(initialLevel ?? startLevel), startIndex)

  // Full path from the LHU root down to the open node
  const [path, setPath] = useState<SpaceNode[]>(() => pathTo(initialIndex))

  const current = path[path.length - 1]
  // Levels above startLevel exist in the data but are never shown
  const crumbs = path.slice(startIndex)

  const open: Open = (...nodes) => setPath((p) => [...p, ...nodes])
  const goTo = (index: number) => setPath((p) => p.slice(0, startIndex + index + 1))

  const View = VIEWS[current.level]

  return (
    <div className="flex flex-col gap-5">
      <SpaceNavigation crumbs={crumbs} onSelect={goTo} />
      {/* key resets the view state (for example the room search) when the node changes */}
      <View key={current.id} node={current} open={open} />
    </div>
  )
}

export default SpaceExplorer
