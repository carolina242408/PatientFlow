package com.projinf.patientflow.dto;

import com.projinf.patientflow.domain.model.Encounter;
import com.projinf.patientflow.domain.model.Patient;

/** Normalized input for a single admission or discharge, independent of its FHIR representation. */
public record ParsedBundleDTO(Patient patient, Encounter encounter, ParsedLocationDTO location) {
}
