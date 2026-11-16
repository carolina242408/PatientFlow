import type { OrgType } from '@/features/lhu-hierarchy/types/tree'

export type DashboardWidgetId =
  | 'hospitalStayByCondition'
  | 'occupancy'
  | 'upcomingDischarges'
  | 'forecast'

export const DASHBOARD_WIDGETS_BY_GROUP = {
  lhu: ['hospitalStayByCondition', 'occupancy', 'upcomingDischarges', 'forecast'],
  unit: ['hospitalStayByCondition', 'occupancy', 'upcomingDischarges', 'forecast'],
  service: ['hospitalStayByCondition', 'occupancy', 'upcomingDischarges', 'forecast'],
} as const satisfies Partial<Record<OrgType, readonly DashboardWidgetId[]>>

export type DashboardGroupType = keyof typeof DASHBOARD_WIDGETS_BY_GROUP

export function getDashboardGroupType(
  groupType: OrgType | undefined,
): groupType is DashboardGroupType {
  return groupType !== undefined && Object.hasOwn(DASHBOARD_WIDGETS_BY_GROUP, groupType)
}
