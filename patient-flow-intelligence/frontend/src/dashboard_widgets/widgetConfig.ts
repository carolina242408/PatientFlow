export type DashboardGroupType = 'ULS' | 'UNIT' | 'SERVICE'

export type DashboardWidgetId =
  | 'hospitalStayByCondition'
  | 'occupancy'
  | 'upcomingDischarges'
  | 'forecast'

const ALL_DASHBOARD_WIDGETS: readonly DashboardWidgetId[] = [
  'hospitalStayByCondition',
  'occupancy',
  'upcomingDischarges',
  'forecast',
]

export const DASHBOARD_WIDGETS_BY_GROUP: Record<
  DashboardGroupType,
  readonly DashboardWidgetId[]
> = {
  ULS: ALL_DASHBOARD_WIDGETS,
  UNIT: ALL_DASHBOARD_WIDGETS,
  SERVICE: ALL_DASHBOARD_WIDGETS,
}

const GROUP_TYPE_PATTERN = /^(ULS|UNIT|SERVICE)_/

export function getDashboardGroupType(groups: readonly string[]): DashboardGroupType | undefined {
  const groupTypes = new Set<DashboardGroupType>()

  for (const path of groups) {
    const segments = path.split('/').filter(Boolean)
    const groupSegment = [...segments].reverse().find((segment) => GROUP_TYPE_PATTERN.test(segment))
    const groupType = groupSegment?.match(GROUP_TYPE_PATTERN)?.[1]

    if (groupType === 'ULS' || groupType === 'UNIT' || groupType === 'SERVICE') {
      groupTypes.add(groupType)
    }
  }

  return groupTypes.size === 1 ? [...groupTypes][0] : undefined
}
