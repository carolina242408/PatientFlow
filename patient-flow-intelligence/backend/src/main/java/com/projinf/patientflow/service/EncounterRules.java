package com.projinf.patientflow.service;

import com.projinf.patientflow.domain.model.*;
import com.projinf.patientflow.dto.ParsedBundleDTO;
import com.projinf.patientflow.exception.ConflictException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

public final class EncounterRules {
    private EncounterRules() { }

    public static Instant precise(Instant value) {
        return value == null ? null : value.truncatedTo(ChronoUnit.MICROS);
    }

    public static void sameEpisode(ParsedBundleDTO input, Encounter stored, LocationAllocation allocation) {
        if (!stored.getPatient().getSnsNumber().equals(input.patient().getSnsNumber())) {
            throw new ConflictException("O episódio pertence a outro doente");
        }
        Instant suppliedStart = input.encounter().getStartPeriod();
        if (suppliedStart != null && !precise(suppliedStart).equals(precise(stored.getStartPeriod()))) {
            throw new ConflictException("Data de admissão contraditória para a mesma visita");
        }
        Bed bed = allocation.getBed();
        var loc = input.location();
        if (!bed.getCode().equals(loc.bedCode()) || !bed.getRoom().getCode().equals(loc.roomCode())
                || !bed.getRoom().getWard().getCode().equals(loc.wardCode())) {
            throw new ConflictException("A localização difere da alocação do episódio");
        }
    }

    public static void version(long actual, long expected) {
        if (actual != expected) throw new ConflictException("Os dados foram alterados; atualize a consulta e repita a operação");
    }
}
