package com.projinf.patientflow.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Transaction-scoped keys also serialize creation, before a patient/visit row exists. */
@Component
@Transactional(propagation = Propagation.MANDATORY)
public class OperationLocks {
    private final JdbcTemplate jdbc;

    public OperationLocks(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void visit(String number) { lock("visit:" + number); }
    public void patient(String sns) { lock("patient:" + sns); }

    private void lock(String key) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text", String.class, key);
    }
}
