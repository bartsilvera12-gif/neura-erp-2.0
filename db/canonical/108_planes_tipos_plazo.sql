-- =============================================================================
-- PLANES: TIPO Y PLAZO (pedido del socio del dueño, 30-oct-2026).
--
--   · planes_tipos: catálogo por empresa para organizar los planes. Borrar un tipo deja sus planes
--     "sin tipo" (no borra planes).
--   · planes.duracion_meses: el plazo con el que nace la suscripción. null = indefinido, 12 = un
--     año, otro valor = lo que se cargue. En cada suscripción se puede cambiar al crearla, y cambiar
--     el plazo de un plan no toca las suscripciones que ya existen (igual que el precio).
--   · Una suscripción siempre es de un plan: plan_id obligatorio y un plan con suscripciones no se
--     puede borrar tampoco desde la base. Si un schema tiene filas viejas sin plan, avisa y solo
--     protege el borrado.
--
-- IDEMPOTENTE. Va después de 107.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create table if not exists :"schema".planes_tipos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) > 0),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_planes_tipos_nombre on :"schema".planes_tipos (empresa_id, lower(nombre));
alter table :"schema".planes_tipos enable row level security;
alter table :"schema".planes_tipos force row level security;
drop policy if exists planes_tipos_propios on :"schema".planes_tipos;
create policy planes_tipos_propios on :"schema".planes_tipos to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".planes_tipos to authenticated, service_role;

alter table :"schema".planes
  add column if not exists tipo_id uuid references :"schema".planes_tipos(id) on delete set null,
  add column if not exists duracion_meses integer;
alter table :"schema".planes drop constraint if exists chk_planes_duracion;
alter table :"schema".planes add constraint chk_planes_duracion
  check (duracion_meses is null or duracion_meses between 1 and 600);
create index if not exists planes_tipo_idx on :"schema".planes (tipo_id);

-- Toda suscripción tiene su plan. NO ACTION (y no RESTRICT): al borrar una empresa o un cliente
-- entero, las cascadas se resuelven dentro de la misma sentencia.
alter table :"schema".suscripciones drop constraint if exists suscripciones_plan_id_fkey;
alter table :"schema".suscripciones add constraint suscripciones_plan_id_fkey
  foreign key (plan_id) references :"schema".planes(id) on delete no action;

do $do$
declare
  v_def text;
  v_patron text := $a$          nullif(p->>'duracion_meses', '')::int,$a$;
  v_nuevo text := $b$          case when p ? 'duracion_meses' then nullif(p->>'duracion_meses', '')::int else v_plan.duracion_meses end,  -- 108: sin indicar, el plazo del plan$b$;
begin
  if exists (select 1 from suscripciones where plan_id is null) then
    raise notice 'Hay suscripciones sin plan: plan_id queda sin NOT NULL hasta asignarles uno.';
  else
    alter table suscripciones alter column plan_id set not null;
  end if;

  v_def := pg_get_functiondef('crear_suscripcion(jsonb)'::regprocedure);
  if position(v_nuevo in v_def) = 0 then
    if position(v_patron in v_def) = 0 then raise exception 'Parche 108: crear_suscripcion no tiene el patrón esperado'; end if;
    execute replace(v_def, v_patron, v_nuevo);
  end if;
end;
$do$;

commit;

notify pgrst, 'reload schema';
