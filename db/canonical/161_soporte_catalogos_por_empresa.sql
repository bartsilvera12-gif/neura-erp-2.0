-- =============================================================================
-- Catálogos de Soporte y tipificación por empresa, también para las empresas NUEVAS.
--
-- La receta 31 los cargaba "para cada empresa que exista". En un clon las recetas corren
-- ANTES de que seed-admin cree la empresa, así que todo cliente nuevo quedaba sin estados,
-- tipos, clasificaciones ni prioridades de Soporte (cualquier cambio de estado de un ticket
-- daba "Estado inválido") y sin el catálogo genérico de tipificación.
--
-- Igual que la sucursal inicial (50), los gastos (52) y los perfiles (55): una función que
-- carga el catálogo de UNA empresa, un trigger al crear la empresa y un relleno de las que
-- ya existen. IDEMPOTENTE: no pisa lo que una empresa ya tenga o haya editado.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create or replace function :"schema".soporte_catalogo_inicial(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  f_sol uuid; f_rec uuid; f_con uuid;
begin
  insert into soporte_config (empresa_id) values (p_empresa) on conflict do nothing;

  insert into soporte_estados (empresa_id, codigo, nombre, tipo, color, area, detiene_sla, es_inicial, sort_order)
  select p_empresa, x.* from (values
    ('pendiente', 'Pendiente', 'abierto', '#f59e0b', 'Atención', false, true, 1),
    ('en_proceso', 'En proceso', 'abierto', '#2563eb', 'Técnico', false, false, 2),
    ('falta_informacion', 'Falta información', 'abierto', '#a855f7', 'Atención', true, false, 3),
    ('listo_revision', 'Listo para revisión', 'abierto', '#0891b2', 'QA', false, false, 4),
    ('reabierto', 'Reabierto', 'abierto', '#ea580c', 'Técnico', false, false, 5),
    ('resuelto', 'Resuelto', 'cerrado', '#16a34a', 'Atención', true, false, 6),
    ('cancelado', 'Cancelado', 'cerrado', '#64748b', null, true, false, 7),
    ('cerrado', 'Cerrado', 'cerrado', '#334155', null, true, false, 8)
  ) as x(codigo, nombre, tipo, color, area, detiene_sla, es_inicial, sort_order)
  on conflict (empresa_id, codigo) do nothing;

  insert into soporte_tipos (empresa_id, codigo, nombre, sla_horas, sort_order)
  select p_empresa, x.* from (values
    ('error', 'Error', 8, 1), ('cambio', 'Cambio', 48, 2), ('consulta', 'Consulta', 8, 3),
    ('capacitacion', 'Capacitación', null::int, 4), ('otro', 'Otro', null::int, 5)
  ) as x(codigo, nombre, sla_horas, sort_order)
  on conflict (empresa_id, codigo) do nothing;

  insert into soporte_clasificaciones (empresa_id, codigo, tipo_codigo, nombre, sla_horas, prioridad_sugerida, sort_order)
  select p_empresa, x.* from (values
    ('error_bajo', 'error', 'Error bajo', 8, 'normal', 1),
    ('error_medio', 'error', 'Error medio', 5, 'alta', 2),
    ('error_alto', 'error', 'Error alto', 2, 'urgente', 3),
    ('cambio_estetico', 'cambio', 'Cambio estético', 5, 'normal', 4),
    ('cambio_funcional', 'cambio', 'Cambio funcional', 48, 'normal', 5)
  ) as x(codigo, tipo_codigo, nombre, sla_horas, prioridad_sugerida, sort_order)
  on conflict (empresa_id, codigo) do nothing;

  insert into soporte_prioridades (empresa_id, codigo, nombre, color, sort_order)
  select p_empresa, x.* from (values
    ('baja', 'Baja', '#64748b', 1), ('normal', 'Normal', '#2563eb', 2), ('alta', 'Alta', '#f59e0b', 3), ('urgente', 'Urgente', '#dc2626', 4)
  ) as x(codigo, nombre, color, sort_order)
  on conflict (empresa_id, codigo) do nothing;

  -- Tipificación genérica de ejemplo (la misma de la 31), solo si la empresa no armó la suya.
  if not exists (select 1 from tipificacion_familias where empresa_id = p_empresa) then
    insert into tipificacion_familias (empresa_id, nombre, sort_order) values (p_empresa, 'SOLICITUD', 1) returning id into f_sol;
    insert into tipificacion_familias (empresa_id, nombre, sort_order) values (p_empresa, 'RECLAMOS', 2) returning id into f_rec;
    insert into tipificacion_familias (empresa_id, nombre, sort_order) values (p_empresa, 'CONSULTAS', 3) returning id into f_con;
    insert into tipificacion_estados (empresa_id, familia_id, nombre, comportamiento, sort_order) values
      (p_empresa, f_sol, 'TICKET-CLIENTE SOLICITA UN CAMBIO O MEJORA', 'ticket_cambio', 1),
      (p_empresa, f_sol, 'CLIENTE SOLICITA CAPACITACIÓN', 'capacitacion', 2),
      (p_empresa, f_sol, 'CLIENTE SOLICITA PRESUPUESTO', null, 3),
      (p_empresa, f_rec, 'TICKET-CLIENTE INDICA UN PROBLEMA CON EL PRODUCTO O SERVICIO', 'ticket_error', 1),
      (p_empresa, f_rec, 'TICKET-CLIENTE INDICA UN ERROR EN SU FACTURA O COBRO', 'ticket_error', 2),
      (p_empresa, f_rec, 'CLIENTE RECLAMA DEMORA EN LA ENTREGA', null, 3),
      (p_empresa, f_con, 'CLIENTE CONSULTA POR FECHA DE PAGO', null, 1),
      (p_empresa, f_con, 'CLIENTE CONSULTA PRECIOS O DISPONIBILIDAD', null, 2),
      (p_empresa, f_con, 'CLIENTE CONSULTA FECHA DE CAPACITACIÓN', null, 3);
  end if;
end;
$fn$;

-- Empresas nuevas.
create or replace function :"schema".tg_empresas_soporte_catalogo()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  perform soporte_catalogo_inicial(new.id);
  return null;
end;
$fn$;
drop trigger if exists trg_empresas_soporte_catalogo on :"schema".empresas;
create trigger trg_empresas_soporte_catalogo after insert on :"schema".empresas
  for each row execute function :"schema".tg_empresas_soporte_catalogo();

-- Empresas que ya existen (las clonadas antes de esta receta quedaron vacías).
do $mig$
declare e record;
begin
  for e in select id from empresas loop
    perform soporte_catalogo_inicial(e.id);
  end loop;
end
$mig$;

revoke execute on function :"schema".soporte_catalogo_inicial(uuid) from public, anon, authenticated;
revoke execute on function :"schema".tg_empresas_soporte_catalogo() from public, anon, authenticated;

commit;
