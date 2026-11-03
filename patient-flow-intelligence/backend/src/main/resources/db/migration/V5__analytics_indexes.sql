CREATE INDEX ix_encounter_service_admission ON encounters(service_id,start_period);
CREATE INDEX ix_encounter_service_discharge ON encounters(service_id,end_period) WHERE end_period IS NOT NULL;
CREATE INDEX ix_encounter_service_expected ON encounters(service_id,expected_discharge_at) WHERE status='IN_PROGRESS';
CREATE INDEX ix_pending_service_due ON admission_requests(service_id,desired_admission_at,requested_at) WHERE status='WAITING';
