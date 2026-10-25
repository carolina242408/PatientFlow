package com.projinf.patientflow.config;

import com.projinf.patientflow.dto.AnalyticsDTO.Thresholds;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("patientflow.analytics")
public record AnalyticsSettings(double occupancyWarningPercent,double occupancyCriticalPercent,int longStayDays,
        double waitingWarningHours,double waitingCriticalHours,int cleaningWarningBeds,double clinicalWarningHours,
        int forecastHistoryDays) {
    public AnalyticsSettings {
        if(!Double.isFinite(occupancyWarningPercent) || !Double.isFinite(occupancyCriticalPercent)
                || occupancyWarningPercent<=0 || occupancyCriticalPercent>100 || occupancyWarningPercent>occupancyCriticalPercent
                || longStayDays<1 || !Double.isFinite(waitingWarningHours) || !Double.isFinite(waitingCriticalHours)
                || waitingWarningHours<=0 || waitingCriticalHours<waitingWarningHours || cleaningWarningBeds<1
                || !Double.isFinite(clinicalWarningHours) || clinicalWarningHours<=0 || forecastHistoryDays<1 || forecastHistoryDays>90) {
            throw new IllegalArgumentException("Limiares analíticos inválidos");
        }
    }
    public Thresholds thresholds() {
        return new Thresholds(occupancyWarningPercent,occupancyCriticalPercent,longStayDays,waitingWarningHours,
            waitingCriticalHours,cleaningWarningBeds,clinicalWarningHours);
    }
}
