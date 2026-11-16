import type { AccessScopeType } from '@/auth/context'

export type DashboardWidgetId =
  | 'hospitalStayByCondition'
  | 'occupancy'
  | 'upcomingDischarges'
  | 'forecast'
  | 'dischargeForecast'

export const DASHBOARD_WIDGETS_BY_GROUP = {
  LHU: [
    'hospitalStayByCondition',
    'occupancy',
    'upcomingDischarges',
    'forecast',
    'dischargeForecast',
  ],
  UNIT: [
    'hospitalStayByCondition',
    'occupancy',
    'upcomingDischarges',
    'forecast',
    'dischargeForecast',
  ],
  SERVICE: [
    'hospitalStayByCondition',
    'occupancy',
    'upcomingDischarges',
    'forecast',
    'dischargeForecast',
  ],
} as const satisfies Partial<Record<AccessScopeType, readonly DashboardWidgetId[]>>

export type DashboardGroupType = keyof typeof DASHBOARD_WIDGETS_BY_GROUP

export function getDashboardWidgets(
  groupType: AccessScopeType | null | undefined,
): readonly DashboardWidgetId[] {
  if (groupType === 'LHU' || groupType === 'UNIT' || groupType === 'SERVICE') {
    return DASHBOARD_WIDGETS_BY_GROUP[groupType]
  }
  return []
}
