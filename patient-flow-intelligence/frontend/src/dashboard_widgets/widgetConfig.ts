import type { AccessScopeType } from '@/auth/context'

export type DashboardWidgetId =
  | 'hospitalStayByCondition'
  | 'occupancy'
  | 'occupancyByUnit'
  | 'occupancyRate'
  | 'upcomingDischarges'
  | 'forecast'
  | 'dischargeForecast'
  | 'exceededStay'
  | 'manualAdmission'

export const DASHBOARD_WIDGETS_BY_GROUP = {
  LHU: [
    'occupancyRate',
    'forecast',
    'occupancy',
    'occupancyByUnit',
    'dischargeForecast',
    'hospitalStayByCondition',
    'upcomingDischarges',
    'exceededStay',
    'manualAdmission',
  ],
  UNIT: [
    'occupancyRate',
    'forecast',
    'occupancy',
    'occupancyByUnit',
    'dischargeForecast',
    'hospitalStayByCondition',
    'upcomingDischarges',
    'exceededStay',
    'manualAdmission',
  ],
  SERVICE: [
    'occupancyRate',
    'forecast',
    'occupancy',
    'dischargeForecast',
    'hospitalStayByCondition',
    'upcomingDischarges',
    'exceededStay',
    'manualAdmission',
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
