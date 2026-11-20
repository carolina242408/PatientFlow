-- Executado uma vez na primeira inicialização do volume do Postgres.
CREATE DATABASE keycloak;
CREATE DATABASE patientflow;

\connect patientflow
CREATE SCHEMA IF NOT EXISTS timescaledb;
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb WITH SCHEMA public;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TimescaleDB extension not installed in image, continuing with standard PostgreSQL schema timescaledb: %', SQLERRM;
END $$;
