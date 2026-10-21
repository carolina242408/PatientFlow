import {
  BedDoubleIcon,
  BedIcon,
  Building2Icon,
  DoorClosedIcon,
  HospitalIcon,
  LayersIcon,
  NetworkIcon,
  SettingsIcon,
  StethoscopeIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react"
import type { OrgNode } from "../types/tree"

const NODE_ICONS: Record<OrgNode["type"], LucideIcon> = {
  lhu: NetworkIcon,
  unit: HospitalIcon,
  building: Building2Icon,
  floor: LayersIcon,
  ward: BedDoubleIcon,
  nursery: StethoscopeIcon,
  room: DoorClosedIcon,
  bed: BedIcon,
  "operating-room": SettingsIcon,
  "treatment-chair": UserIcon,
}

export function HierarchyNodeIcon({ type }: { type: OrgNode["type"] }) {
  const Icon = NODE_ICONS[type]
  return (
    <span className="bg-[#F9FAFB] p-1 rounded-md">
      <Icon className="h-4 w-4" />
    </span>
  )
}
