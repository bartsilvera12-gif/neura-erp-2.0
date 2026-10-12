-- =============================================================================
-- Conversaciones: barrido de SLA cada minuto (pg_cron).
-- APLICAR CONECTADO COMO supabase_admin:
--   psql -U supabase_admin -v schema=<schema> -f 38b_conversaciones_cron.sql
-- Un job por schema de tenant (el nombre lleva el schema). IDEMPOTENTE.
-- =============================================================================
create extension if not exists pg_cron;
\set job chat_sla_:schema
select cron.unschedule(jobid) from cron.job where jobname = :'job';
select cron.schedule(:'job', '* * * * *', format('select %I.chat_sla_barrer()', :'schema'));
