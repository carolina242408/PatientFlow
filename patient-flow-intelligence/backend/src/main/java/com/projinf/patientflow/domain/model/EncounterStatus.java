package com.projinf.patientflow.domain.model;

public enum EncounterStatus {
    IN_PROGRESS("in-progress"),
    FINISHED("finished");

    private final String fhirCode;

    EncounterStatus(String fhirCode) {
        this.fhirCode = fhirCode;
    }

    public String getFhirCode() {
        return fhirCode;
    }

    public static EncounterStatus fromFhirCode(String code) {
        for (EncounterStatus s : values()) {
            if (s.fhirCode.equals(code)) return s;
        }
        throw new IllegalArgumentException("Estado de Encounter não suportado: " + code);
    }
}
