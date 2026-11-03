package com.projinf.patientflow.service;

import com.projinf.patientflow.dto.AnalyticsDTO.*;
import com.projinf.patientflow.repository.AnalyticsRepository;
import java.util.*;

/** Baselines shared by contract with the Python service. No fitting or trained parameters. */
public final class DecisionRules {
    public static final String VERSION="rules-v1";
    private DecisionRules() { }
    public static RankOutput rank(RankInput input) {
        var sorted=input.candidates().stream().sorted(Comparator.comparingInt(DecisionRules::score).reversed()
            .thenComparing(Candidate::wardCode).thenComparing(Candidate::roomCode).thenComparing(Candidate::bedCode)
            .thenComparing(c->c.bedId().toString())).limit(input.limit()).map(c->{
                List<String> reasons=new ArrayList<>(List.of("SERVICE_MATCH","AVAILABLE"));
                if(c.preferredWard()) reasons.add("PREFERRED_WARD");
                reasons.add(c.occupiedInRoom()==0 ? "EMPTY_ROOM" : "ROOM_OCCUPANCY_PENALTY");
                return new RankedBed(c.bedId(),score(c),reasons);
            }).toList();
        return new RankOutput(VERSION,sorted);
    }
    private static int score(Candidate candidate) {
        return 100+(candidate.preferredWard()?20:0)-(int)Math.min(candidate.occupiedInRoom(),10)*5;
    }
    public static ForecastOutput forecast(ForecastBatch input) {
        return new ForecastOutput(VERSION,input.services().stream().map(s->new ServiceEstimate(s.serviceId(),
            List.of(horizon(s,input.historyDays(),24),horizon(s,input.historyDays(),48)))).toList());
    }
    private static Horizon horizon(ForecastInput input,int days,int hours) {
        long known=hours==24 ? input.knownAdmissions24h() : input.knownAdmissions48h();
        long planned=hours==24 ? input.plannedDischarges24h() : input.plannedDischarges48h();
        double admissions=known+input.historicalUnscheduledAdmissions()*hours/(days*24d);
        double discharges=Math.min(input.occupied(),Math.max(planned,input.historicalDischarges()*hours/(days*24d)));
        double demand=Math.max(0,input.occupied()+admissions-discharges);
        double occupied=Math.min(input.capacity(),demand);
        return new Horizon(hours,round(admissions),round(discharges),round(occupied),
            input.capacity()==0?null:round(occupied*100d/input.capacity()),round(Math.max(0,demand-input.capacity())));
    }
    private static double round(double value) { return AnalyticsRepository.round(value); }
}
