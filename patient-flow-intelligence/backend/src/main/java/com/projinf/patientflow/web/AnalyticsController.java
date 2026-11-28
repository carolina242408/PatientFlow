package com.projinf.patientflow.web;

import com.projinf.patientflow.dto.AnalyticsDTO.*;
import com.projinf.patientflow.dto.OperationalDTO.Scope;
import com.projinf.patientflow.service.AnalyticsService;
import java.time.Instant;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class AnalyticsController {
    private final AnalyticsService analytics;
    public AnalyticsController(AnalyticsService analytics) { this.analytics=analytics; }
    @GetMapping("/analytics/indicators")
    public Indicators indicators(@ModelAttribute Scope scope,@RequestParam(required=false) Instant from,@RequestParam(required=false) Instant to) {
        return analytics.indicators(scope,from,to);
    }
    @GetMapping("/analytics/alerts")
    public Alerts alerts(@ModelAttribute Scope scope) { return analytics.alerts(scope); }
    @GetMapping("/analytics/occupancy")
    public Occupancy occupancy(@ModelAttribute Scope scope) { return analytics.occupancy(scope); }
    @GetMapping("/analytics/discharge-forecast")
    public java.util.List<DischargeForecastDay> dischargeForecast(@ModelAttribute Scope scope) {
        return analytics.dischargeForecast(scope);
    }
    @GetMapping("/analytics/stay-by-condition")
    public java.util.List<ConditionStayMean> stayByCondition(@ModelAttribute Scope scope,
            @RequestParam(required=false) Instant from,
            @RequestParam(required=false) Instant to) {
        return analytics.stayByCondition(scope, from, to);
    }
    @GetMapping("/analytics/occupancy-forecast")
    public Forecast forecast(@ModelAttribute Scope scope,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="20") int size) {
        return analytics.forecast(scope,page,size);
    }
    @GetMapping("/admission-requests/{id}/bed-suggestions")
    public BedSuggestions suggestions(@PathVariable UUID id,@RequestParam(required=false) UUID preferredWardId,
            @RequestParam(defaultValue="5") int limit) { return analytics.suggestions(id,preferredWardId,limit); }
    @GetMapping("/analytics/patients-exceeded-stay")
    public java.util.List<ExceededStayPatient> patientsExceededStay(@ModelAttribute Scope scope) {
        return analytics.patientsExceededStay(scope);
    }
}
