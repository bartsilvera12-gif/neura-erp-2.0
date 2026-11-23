-- =============================================================================
-- 170 — Acceso suspendido por falta de pago (bloqueo del ERP).
--
-- Bandera en `empresas` que el portón (middleware) lee para mostrar la pantalla
-- "Acceso suspendido por falta de pago". La escribe el panel de Neura
-- (sistemas-propio) vía service-role; el ERP solo la lee.
--
-- Aditivo e IDEMPOTENTE. Nace apagado (default false) → nadie se ve afectado
-- hasta que Neura lo prenda para una empresa puntual.
-- =============================================================================
begin;
set local search_path to :"schema", public;

alter table :"schema".empresas
  add column if not exists acceso_suspendido boolean not null default false,
  add column if not exists suspendido_motivo text,
  add column if not exists suspendido_at     timestamptz;

commit;

-- Recargar PostgREST para que la API vea las columnas nuevas.
notify pgrst, 'reload schema';
