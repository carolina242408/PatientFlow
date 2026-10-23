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
import { cn } from "@/lib/utils"
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

export function HierarchyNodeIcon({
  type,
  className,
  iconClassName = "h-4 w-4",
}: {
  type: OrgNode["type"]
  className?: string
  iconClassName?: string
}) {
  const Icon = NODE_ICONS[type]
  return (
    <span className={cn("inline-flex rounded-md bg-[#F9FAFB] p-1", className)}>
      <Icon className={iconClassName} />
    </span>
  )
}
