-- =============================================================================
-- Agenda completa (como el módulo Agenda del sistema actual):
--   · agenda_cita_responsables: una cita puede tener VARIOS responsables (el principal
--     sigue en agenda_citas.responsable_id y también va acá)
--   · agenda_citas.updated_by
-- Las citas ya existían desde 31_soporte.sql (capacitaciones de la tipificación).
-- IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;

alter table :"schema".agenda_citas add column if not exists updated_by uuid;
alter table :"schema".agenda_citas alter column tipo drop default;
alter table :"schema".agenda_citas alter column tipo set default 'reunion';

create table if not exists :"schema".agenda_cita_responsables (
  cita_id uuid not null references :"schema".agenda_citas(id) on delete cascade,
  usuario_id uuid not null references :"schema".usuarios(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cita_id, usuario_id)
);
create index if not exists agenda_cita_resp_usuario_idx on :"schema".agenda_cita_responsables (usuario_id);
alter table :"schema".agenda_cita_responsables enable row level security;
alter table :"schema".agenda_cita_responsables force row level security;
drop policy if exists agenda_cita_resp_propias on :"schema".agenda_cita_responsables;
create policy agenda_cita_resp_propias on :"schema".agenda_cita_responsables to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".agenda_cita_responsables to authenticated, service_role;

-- Las citas que ya existen: su responsable principal también en la tabla nueva.
insert into :"schema".agenda_cita_responsables (cita_id, usuario_id, empresa_id)
select c.id, c.responsable_id, c.empresa_id from :"schema".agenda_citas c
 where c.responsable_id is not null
on conflict do nothing;

create index if not exists agenda_empresa_inicio_idx on :"schema".agenda_citas (empresa_id, inicio_at);
