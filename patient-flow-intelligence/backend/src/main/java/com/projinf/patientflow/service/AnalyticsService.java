package com.projinf.patientflow.service;

import com.projinf.patientflow.config.AnalyticsSettings;
import com.projinf.patientflow.dto.AnalyticsDTO.*;
import com.projinf.patientflow.dto.OperationalDTO.*;
import com.projinf.patientflow.exception.ConflictException;
import com.projinf.patientflow.repository.AnalyticsRepository;
import com.projinf.patientflow.repository.OperationalQueries;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
public class AnalyticsService {
    private final AnalyticsRepository repository;
    private final OperationalQueries queries;
    private final AnalyticsSettings settings;
    private final AlgorithmsClient algorithms;
    private final Clock clock;
    public AnalyticsService(AnalyticsRepository repository,OperationalQueries queries,AnalyticsSettings settings,
            AlgorithmsClient algorithms,Clock clock) {
        this.repository=repository; this.queries=queries; this.settings=settings; this.algorithms=algorithms; this.clock=clock;
    }
    public Indicators indicators(Scope scope,Instant from,Instant to) {
        Instant now=clock.instant();
        if(to==null) to=now;
        if(from==null) from=to.minus(Duration.ofDays(30));
        if(!from.isBefore(to) || to.isAfter(now) || Duration.between(from,to).compareTo(Duration.ofDays(366))>0)
            throw new IllegalArgumentException("Período deve ser anterior a agora, from < to e no máximo 366 dias");
        return repository.indicators(scope,from,to,now,settings);
    }
    public Alerts alerts(Scope scope) {
        var m=indicators(scope,null,null);
        List<Alert> alerts=new ArrayList<>();
        var b=m.beds(); var s=m.stays(); var w=m.waiting();
        if(b.occupancyPercent()!=null && b.occupancyPercent()>=settings.occupancyWarningPercent()) {
            boolean critical=b.occupancyPercent()>=settings.occupancyCriticalPercent();
            alerts.add(new Alert("OCCUPANCY_PRESSURE",critical?Severity.CRITICAL:Severity.WARNING,
                "Ocupação excede o limiar; capacidade exclui camas bloqueadas",b.occupancyPercent(),
                critical?settings.occupancyCriticalPercent():settings.occupancyWarningPercent(),"percent",b.occupied()));
        }
        if(b.available()==0 && w.dueNow()>0) alerts.add(new Alert("NO_AVAILABLE_BEDS",Severity.CRITICAL,
            "Existem pedidos já devidos e nenhuma cama disponível no âmbito",0,0,"beds",w.dueNow()));
        if(w.oldestWaitingHours()!=null && w.oldestWaitingHours()>=settings.waitingWarningHours()) {
            boolean critical=w.oldestWaitingHours()>=settings.waitingCriticalHours();
            alerts.add(new Alert("WAITING_TIME",critical?Severity.CRITICAL:Severity.WARNING,
                "Espera contada desde a data pretendida ou criação, usando a mais recente",w.oldestWaitingHours(),
                critical?settings.waitingCriticalHours():settings.waitingWarningHours(),"hours",w.overdue()));
        }
        if(b.cleaning()>=settings.cleaningWarningBeds()) alerts.add(new Alert("CLEANING_BACKLOG",Severity.WARNING,
            "Camas em limpeza reduzem a disponibilidade imediata",b.cleaning(),settings.cleaningWarningBeds(),"beds",b.cleaning()));
        if(s.prolongedActiveStays()>0) alerts.add(new Alert("PROLONGED_STAYS",Severity.WARNING,
            "Existem episódios ativos com duração igual ou superior ao limiar de dias",s.oldestActiveStayDays(),
            settings.longStayDays(),"days",s.prolongedActiveStays()));
        if(s.oldestClinicalPendingHours()!=null && s.oldestClinicalPendingHours()>=settings.clinicalWarningHours())
            alerts.add(new Alert("CLINICAL_DISCHARGE_DELAY",Severity.WARNING,"Alta clínica registada sem alta administrativa",
                s.oldestClinicalPendingHours(),settings.clinicalWarningHours(),"hours",s.clinicalDischargePending()));
        if(s.overdueExpectedDischarges()>0) alerts.add(new Alert("OVERDUE_DISCHARGE_PLAN",Severity.WARNING,
            "Data prevista de alta já ultrapassada em episódios ainda ativos",s.overdueExpectedDischarges(),0,"encounters",s.overdueExpectedDischarges()));
        return new Alerts(m.asOf(),scope,settings.thresholds(),alerts);
    }

    public Occupancy occupancy(Scope scope) {
        var result = repository.occupancy(scope,clock.instant());
        return new Occupancy(result.asOf(),result.scope(),settings.occupancyCriticalPercent(),
            result.services(),result.units());
    }

    public BedSuggestions suggestions(UUID requestId,UUID preferredWard,int limit) {
        if(limit<1 || limit>20) throw new IllegalArgumentException("limit entre 1 e 20");
        var request=queries.request(requestId); // Authorizes the request before exposing any candidates.
        if(request.status()!=RequestStatus.WAITING) throw new ConflictException("Pedido já encerrado");
        if(preferredWard!=null) repository.preferredWard(preferredWard,request.serviceId());
        var assumptions=List.of("Apenas camas AVAILABLE do serviço solicitado",
            "Score 100 + 20 por enfermaria preferida - 5 por cama ocupada no quarto (penalização máxima 50)",
            "Desempate por códigos de enfermaria, quarto, cama e UUID; a prioridade ordena pedidos, não camas",
            "Sem critérios clínicos de isolamento, equipamento ou especialidade adicional; confirmar disponibilidade ao admitir");
        if(repository.activeStay(request.patientId())) return new BedSuggestions(clock.instant(),requestId,request.serviceId(),false,
            "ACTIVE_ENCOUNTER",0,new Engine("BACKEND_BASELINE",DecisionRules.VERSION,false,"INELIGIBLE"),assumptions,List.of());
        var candidates=repository.candidates(request.serviceId(),preferredWard);
        var decision=algorithms.rank(new RankInput(limit,candidates));
        Map<UUID,Candidate> byId=new HashMap<>(); candidates.forEach(c->byId.put(c.bedId(),c));
        var recommendations=decision.value().recommendations().stream().map(r->{var c=byId.get(r.bedId());
            return new SuggestedBed(c.bedId(),c.wardCode(),c.roomCode(),c.bedCode(),r.score(),r.reasons());}).toList();
        return new BedSuggestions(clock.instant(),requestId,request.serviceId(),true,null,candidates.size(),decision.engine(),assumptions,recommendations);
    }

    public Forecast forecast(Scope scope,int page,int size) {
        Instant now=clock.instant(),from=now.minus(Duration.ofDays(settings.forecastHistoryDays()));
        var source=repository.forecastInputs(scope,from,now,page,size,settings);
        var decision=algorithms.forecast(new ForecastBatch(settings.forecastHistoryDays(),source.content().stream().map(ServiceInput::input).toList()));
        Map<UUID,ServiceEstimate> estimates=new HashMap<>(); decision.value().services().forEach(e->estimates.put(e.serviceId(),e));
        var rows=source.content().stream().map(s->new ServiceForecast(s.serviceName(),s.input(),estimates.get(s.input().serviceId()).horizons(),
            s.input().historicalUnscheduledAdmissions()+s.input().historicalDischarges()==0 ? "NO_OBSERVED_HISTORY" : "OBSERVED_COUNTS_ONLY")).toList();
        return new Forecast(now,from,now,settings.forecastHistoryDays(),scope,decision.engine(),List.of(
            "Cenário determinístico rules-v1, sem modelo treinado ou garantia probabilística",
            "Capacidade constante: todas as camas exceto BLOCKED; não estima duração de limpeza",
            "Admissões = fila conhecida até ao horizonte + média histórica de admissões sem pedido associado",
            "Altas = máximo entre altas previstas futuras e média histórica, limitado à ocupação atual",
            "Ocupação limitada à capacidade por serviço; excesso reportado como unmetDemand",
            "Sem extrapolar futuros pedidos planeados desconhecidos; cobertura histórica e dados sintéticos limitam a estimativa"),
            new PageResult<>(rows,source.page(),source.size(),source.totalElements(),source.totalPages()));
    }
}
