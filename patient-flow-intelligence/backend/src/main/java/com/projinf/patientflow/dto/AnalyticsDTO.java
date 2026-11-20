package com.projinf.patientflow.dto;

import com.projinf.patientflow.dto.OperationalDTO.*;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class AnalyticsDTO {
    private AnalyticsDTO() { }
    public record Thresholds(double occupancyWarningPercent,double occupancyCriticalPercent,int longStayDays,
            double waitingWarningHours,double waitingCriticalHours,int cleaningWarningBeds,double clinicalWarningHours) { }
    public record BedIndicators(long total,long capacity,long available,long occupied,long blocked,long cleaning,Double occupancyPercent) { }
    public record StayIndicators(long active,long admissionsInPeriod,long dischargesInPeriod,long lengthOfStaySamples,
            Double averageLengthOfStayDays,long prolongedActiveStays,Double oldestActiveStayDays,long clinicalDischargePending,
            Double oldestClinicalPendingHours,long dischargeDelaySamples,Double averageClinicalAdministrativeHours,
            long expectedDischarges24h,long expectedDischarges48h,long overdueExpectedDischarges) { }
    public record WaitingIndicators(long pending,long dueNow,long emergencyDueNow,long overdue,
            Double averageWaitingHours,Double oldestWaitingHours) { }
    public record Indicators(Instant asOf,Instant periodFrom,Instant periodTo,Scope scope,
            BedIndicators beds,StayIndicators stays,WaitingIndicators waiting,Thresholds thresholds) { }
    public enum Severity { WARNING, CRITICAL }
    public record Alert(String code,Severity severity,String explanation,double observed,double threshold,String unit,long affectedCount) { }
    public record Alerts(Instant asOf,Scope scope,Thresholds thresholds,List<Alert> alerts) { }
    public record OccupancyRow(UUID id,String name,long occupied,long capacity,Double occupancyPercent) { }
    public record Occupancy(Instant asOf,Scope scope,double criticalOccupancyPercent,
            List<OccupancyRow> services,List<OccupancyRow> units,List<OccupancyRow> wings) { }
    public record DischargeForecastDay(String date,int dayOfWeek,long expectedDischarges) { }

    // Versioned data-only contract with algorithms: no SNS, name, birth date or access token.
    public record Candidate(UUID bedId,String wardCode,String roomCode,String bedCode,long occupiedInRoom,boolean preferredWard) { }
    public record RankInput(int limit,List<Candidate> candidates) { }
    public record RankedBed(UUID bedId,int score,List<String> reasons) { }
    public record RankOutput(String algorithmVersion,List<RankedBed> recommendations) { }
    public record ForecastInput(UUID serviceId,long capacity,long occupied,long historicalUnscheduledAdmissions,
            long historicalDischarges,long knownAdmissions24h,long knownAdmissions48h,
            long plannedDischarges24h,long plannedDischarges48h) { }
    public record ForecastBatch(int historyDays,List<ForecastInput> services) { }
    public record Horizon(int hours,double expectedAdmissions,double expectedDischarges,double projectedOccupied,
            Double occupancyPercent,double unmetDemand) { }
    public record ServiceEstimate(UUID serviceId,List<Horizon> horizons) { }
    public record ForecastOutput(String algorithmVersion,List<ServiceEstimate> services) { }
    public record Engine(String source,String algorithmVersion,boolean degraded,String reason) { }
    public record Decision<T>(Engine engine,T value) { }
    public record SuggestedBed(UUID bedId,String wardCode,String roomCode,String bedCode,int score,List<String> reasons) { }
    public record BedSuggestions(Instant asOf,UUID requestId,UUID serviceId,boolean eligible,String ineligibleReason,
            long candidateCount,Engine engine,List<String> assumptions,List<SuggestedBed> recommendations) { }
    public record ServiceInput(String serviceName,ForecastInput input) { }
    public record ServiceForecast(String serviceName,ForecastInput input,List<Horizon> horizons,String historyQuality) { }
    public record Forecast(Instant asOf,Instant historyFrom,Instant historyTo,int historyDays,Scope scope,
            Engine engine,List<String> assumptions,PageResult<ServiceForecast> services) { }
}
