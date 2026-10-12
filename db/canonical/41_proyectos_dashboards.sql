-- =============================================================================
-- PROYECTOS · Tareas del equipo, Dashboard Ejecutivo y Dashboard PM (núcleo genérico).
-- Constantes del actual (src/lib/proyectos/dashboard/config.ts), acá parametrizables:
--   WIP por técnico 4 · "vence pronto" 3 días · sin movimiento 9 h laborales ·
--   semáforo del SLA del estado: <70% verde, 70-90% amarillo, 90-100% naranja, >100% rojo
-- Cada pantalla es UNA consulta.
-- IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;

create table if not exists :"schema".proyecto_config (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  wip_por_tecnico integer not null default 4 check (wip_por_tecnico between 1 and 50),
  vence_pronto_dias integer not null default 3 check (vence_pronto_dias between 1 and 60),
  sin_movimiento_horas integer not null default 9 check (sin_movimiento_horas between 1 and 500),
  updated_at timestamptz not null default now()
);
alter table :"schema".proyecto_config enable row level security;
alter table :"schema".proyecto_config force row level security;
drop policy if exists proyecto_config_propia on :"schema".proyecto_config;
create policy proyecto_config_propia on :"schema".proyecto_config to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".proyecto_config to authenticated, service_role;
insert into :"schema".proyecto_config (empresa_id) select id from :"schema".empresas on conflict do nothing;

-- Proyectos abiertos con sus métricas vivas (base de las tres pantallas).
create or replace function :"schema".proyectos_abiertos_metricas()
returns table (
  id uuid, numero text, titulo text, prioridad text, cliente_id uuid, cliente_nombre text,
  estado_id uuid, estado_nombre text, estado_color text, tipo_sla text, rol text, sla_horas_objetivo numeric,
  estado_desde timestamptz, horas_en_estado numeric, sla_pct numeric, semaforo text,
  fecha_prometida timestamptz, vencido boolean, vence_pronto boolean, sin_fecha boolean,
  bloqueado boolean, bloqueo_tipo text, bloqueo_motivo text, sin_movimiento boolean, ultimo_movimiento_at timestamptz,
  responsable_tecnico_id uuid, tecnico_nombre text, project_manager_id uuid, pm_nombre text,
  responsable_comercial_id uuid, comercial_nombre text, monto_vendido numeric, moneda text,
  tareas_total bigint, tareas_hechas bigint
) language sql stable security invoker set search_path = :"schema", public as $$
  with cfg as (select coalesce((select vence_pronto_dias from proyecto_config where empresa_id = empresa_actual()), 3) as vp,
                      coalesce((select sin_movimiento_horas from proyecto_config where empresa_id = empresa_actual()), 9) as sm)
  select p.id, p.numero, p.titulo, p.prioridad, p.cliente_id, c.nombre,
         e.id, e.nombre, e.color, e.tipo_sla, e.rol, e.sla_horas_objetivo,
         p.estado_desde, h.horas,
         case when e.tipo_sla = 'interno' and e.sla_horas_objetivo > 0 then round(100 * h.horas / e.sla_horas_objetivo, 1) end,
         case when e.tipo_sla <> 'interno' or coalesce(e.sla_horas_objetivo, 0) = 0 then 'sin_sla'
              when h.horas > e.sla_horas_objetivo then 'rojo'
              when h.horas >= 0.9 * e.sla_horas_objetivo then 'naranja'
              when h.horas >= 0.7 * e.sla_horas_objetivo then 'amarillo' else 'verde' end,
         p.fecha_prometida,
         p.fecha_prometida < now(),
         p.fecha_prometida >= now() and p.fecha_prometida < now() + make_interval(days => cfg.vp),
         p.fecha_prometida is null,
         p.bloqueado, p.bloqueo_tipo, p.bloqueo_motivo,
         e.tipo_sla = 'interno' and horas_laborales_entre(p.ultimo_movimiento_at, now()) > cfg.sm,
         p.ultimo_movimiento_at,
         p.responsable_tecnico_id, ut.nombre, p.project_manager_id, up.nombre, p.responsable_comercial_id, uc.nombre,
         p.monto_vendido, p.moneda,
         (select count(*) from proyecto_tareas t where t.proyecto_id = p.id),
         (select count(*) from proyecto_tareas t where t.proyecto_id = p.id and t.estado = 'completada')
    from proyectos p
    join proyecto_estados e on e.id = p.estado_id
    cross join cfg
    cross join lateral (select horas_laborales_entre(p.estado_desde, now()) as horas) h
    left join clientes c on c.id = p.cliente_id
    left join usuarios ut on ut.id = p.responsable_tecnico_id
    left join usuarios up on up.id = p.project_manager_id
    left join usuarios uc on uc.id = p.responsable_comercial_id
   where p.empresa_id = empresa_actual() and not p.archivado and not e.es_final
$$;

-- ── Tareas del equipo: una tarjeta por técnico con sus proyectos activos ────
create or replace function :"schema".proyectos_tareas_equipo()
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  with m as (select * from proyectos_abiertos_metricas()),
  cfg as (select coalesce((select wip_por_tecnico from proyecto_config where empresa_id = empresa_actual()), 4) as wip),
  tecnicos as (
    select u.id, u.nombre from usuarios u
     where u.empresa_id = empresa_actual() and u.activo
       and (u.es_tecnico or exists (select 1 from m where m.responsable_tecnico_id = u.id))
  )
  select jsonb_build_object(
    'wip', (select wip from cfg),
    'tecnicos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'nombre', t.nombre,
        'activos', (select count(*) from m where m.responsable_tecnico_id = t.id and m.tipo_sla = 'interno'),
        'en_espera', (select count(*) from m where m.responsable_tecnico_id = t.id and m.tipo_sla <> 'interno'),
        'vencidos', (select count(*) from m where m.responsable_tecnico_id = t.id and m.vencido),
        'sla_rojo', (select count(*) from m where m.responsable_tecnico_id = t.id and m.semaforo = 'rojo'),
        'sobre_wip', (select count(*) from m where m.responsable_tecnico_id = t.id and m.tipo_sla = 'interno') > (select wip from cfg),
        'entregados_mes', (select count(*) from proyectos x join proyecto_estados e on e.id = x.estado_id
                            where x.empresa_id = empresa_actual() and x.responsable_tecnico_id = t.id and e.rol = 'entregado'
                              and x.fecha_entrega >= date_trunc('month', now() at time zone 'America/Asuncion') at time zone 'America/Asuncion'),
        'proyectos', coalesce((select jsonb_agg(to_jsonb(m) order by
                         case m.prioridad when 'urgente' then 0 when 'alta' then 1 when 'normal' then 2 else 3 end,
                         m.fecha_prometida nulls last)
                       from m where m.responsable_tecnico_id = t.id), '[]'::jsonb)
      ) order by t.nombre) from tecnicos t), '[]'::jsonb),
    'sin_tecnico', coalesce((select jsonb_agg(to_jsonb(m) order by m.estado_desde) from m where m.responsable_tecnico_id is null), '[]'::jsonb)
  )
$$;

-- ── Dashboard Ejecutivo (período) ────────────────────────────────────────────
create or replace function :"schema".proyectos_dashboard_ejecutivo(p_desde date default null, p_hasta date default null)
returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  with per as (
    select coalesce(p_desde, date_trunc('month', now() at time zone 'America/Asuncion')::date) as d,
           coalesce(p_hasta, (now() at time zone 'America/Asuncion')::date) as h
  ),
  rango as (select per.d::timestamp at time zone 'America/Asuncion' as ini, (per.h + 1)::timestamp at time zone 'America/Asuncion' as fin from per),
  m as (select * from proyectos_abiertos_metricas()),
  entregados as (
    select x.* from proyectos x join proyecto_estados e on e.id = x.estado_id, rango
     where x.empresa_id = empresa_actual() and e.rol = 'entregado' and x.fecha_entrega >= rango.ini and x.fecha_entrega < rango.fin
  ),
  ingresados as (
    select x.* from proyectos x, per where x.empresa_id = empresa_actual() and x.fecha_ingreso between per.d and per.h
  ),
  tramos as (
    select h.estado_id, h.horas_laborales from proyecto_estado_historial h, rango
     where h.empresa_id = empresa_actual() and h.exited_at >= rango.ini and h.exited_at < rango.fin and h.horas_laborales is not null
  )
  select jsonb_build_object(
    'periodo', (select jsonb_build_object('desde', d, 'hasta', h) from per),
    'kpis', jsonb_build_object(
      'activos', (select count(*) from m),
      'en_curso', (select count(*) from m where tipo_sla = 'interno'),
      'esperando_cliente', (select count(*) from m where tipo_sla = 'cliente'),
      'pausados', (select count(*) from m where tipo_sla = 'pausado'),
      'vencidos', (select count(*) from m where vencido),
      'vencen_pronto', (select count(*) from m where vence_pronto),
      'sin_fecha', (select count(*) from m where sin_fecha),
      'bloqueados', (select count(*) from m where bloqueado),
      'sin_movimiento', (select count(*) from m where sin_movimiento),
      'sla_rojo', (select count(*) from m where semaforo = 'rojo'),
      'ingresados', (select count(*) from ingresados),
      'entregados', (select count(*) from entregados),
      'entregados_a_tiempo', (select count(*) from entregados where fecha_prometida is not null and fecha_entrega <= fecha_prometida),
      'entregados_con_fecha', (select count(*) from entregados where fecha_prometida is not null),
      'monto_entregado_gs', (select coalesce(sum(monto_vendido), 0) from entregados where moneda = 'GS'),
      'monto_ingresado_gs', (select coalesce(sum(monto_vendido), 0) from ingresados where moneda = 'GS'),
      'dias_promedio_entrega', (select round(avg(extract(epoch from (fecha_entrega - created_at)) / 86400.0), 1) from entregados)),
    'por_estado', coalesce((select jsonb_agg(jsonb_build_object(
        'estado_id', e.id, 'nombre', e.nombre, 'color', e.color, 'tipo_sla', e.tipo_sla, 'objetivo', e.sla_horas_objetivo,
        'cantidad', (select count(*) from m where m.estado_id = e.id),
        'rojos', (select count(*) from m where m.estado_id = e.id and m.semaforo = 'rojo'),
        'horas_promedio_actual', (select round(avg(horas_en_estado), 1) from m where m.estado_id = e.id),
        'horas_promedio_periodo', (select round(avg(horas_laborales), 1) from tramos t where t.estado_id = e.id),
        'pasaron_periodo', (select count(*) from tramos t where t.estado_id = e.id)
      ) order by e.orden) from proyecto_estados e where e.empresa_id = empresa_actual() and e.activo and not e.es_final), '[]'::jsonb),
    'por_tecnico', coalesce((select jsonb_agg(r order by r->>'nombre') from (
        select jsonb_build_object('id', u.id, 'nombre', coalesce(u.nombre, 'Sin técnico'),
          'activos', count(m.*) filter (where m.tipo_sla = 'interno'),
          'en_espera', count(m.*) filter (where m.tipo_sla <> 'interno'),
          'vencidos', count(m.*) filter (where m.vencido),
          'sla_rojo', count(m.*) filter (where m.semaforo = 'rojo'),
          'entregados', (select count(*) from entregados x where x.responsable_tecnico_id is not distinct from u.id),
          'a_tiempo', (select count(*) from entregados x where x.responsable_tecnico_id is not distinct from u.id and x.fecha_prometida is not null and x.fecha_entrega <= x.fecha_prometida)) as r
          from m left join usuarios u on u.id = m.responsable_tecnico_id
         group by u.id, u.nombre) s), '[]'::jsonb),
    'por_pm', coalesce((select jsonb_agg(r order by r->>'nombre') from (
        select jsonb_build_object('id', u.id, 'nombre', coalesce(u.nombre, 'Sin PM'),
          'activos', count(m.*), 'vencidos', count(m.*) filter (where m.vencido),
          'bloqueados', count(m.*) filter (where m.bloqueado), 'esperando_cliente', count(m.*) filter (where m.tipo_sla = 'cliente'),
          'entregados', (select count(*) from entregados x where x.project_manager_id is not distinct from u.id)) as r
          from m left join usuarios u on u.id = m.project_manager_id
         group by u.id, u.nombre) s), '[]'::jsonb),
    'atencion', coalesce((select jsonb_agg(to_jsonb(m) order by m.vencido desc, m.semaforo = 'rojo' desc, m.fecha_prometida nulls last)
                            from (select * from m where vencido or semaforo = 'rojo' or bloqueado or sin_movimiento limit 50) m), '[]'::jsonb)
  )
$$;

-- ── Dashboard PM (la cartera de un PM; null = el usuario actual) ───────────
create or replace function :"schema".proyectos_dashboard_pm(p_pm uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = :"schema", public as $$
declare v_pm uuid := p_pm;
begin
  if v_pm is null then select id into v_pm from usuarios where auth_user_id = auth.uid() limit 1; end if;
  return (
  with m as (select * from proyectos_abiertos_metricas() x where x.project_manager_id = v_pm)
  select jsonb_build_object(
    'pm', (select jsonb_build_object('id', id, 'nombre', nombre) from usuarios where id = v_pm),
    'kpis', jsonb_build_object(
      'activos', (select count(*) from m), 'vencidos', (select count(*) from m where vencido),
      'vencen_pronto', (select count(*) from m where vence_pronto), 'sin_fecha', (select count(*) from m where sin_fecha),
      'bloqueados', (select count(*) from m where bloqueado), 'esperando_cliente', (select count(*) from m where tipo_sla = 'cliente'),
      'sin_movimiento', (select count(*) from m where sin_movimiento), 'sla_rojo', (select count(*) from m where semaforo = 'rojo'),
      'entregados_mes', (select count(*) from proyectos x join proyecto_estados e on e.id = x.estado_id
                          where x.empresa_id = empresa_actual() and x.project_manager_id = v_pm and e.rol = 'entregado'
                            and x.fecha_entrega >= date_trunc('month', now() at time zone 'America/Asuncion') at time zone 'America/Asuncion')),
    'vencidos', coalesce((select jsonb_agg(to_jsonb(m) order by fecha_prometida) from m where vencido), '[]'::jsonb),
    'vencen_pronto', coalesce((select jsonb_agg(to_jsonb(m) order by fecha_prometida) from m where vence_pronto), '[]'::jsonb),
    'bloqueados', coalesce((select jsonb_agg(to_jsonb(m) order by estado_desde) from m where bloqueado), '[]'::jsonb),
    'esperando_cliente', coalesce((select jsonb_agg(to_jsonb(m) order by estado_desde) from m where tipo_sla = 'cliente'), '[]'::jsonb),
    'sin_movimiento', coalesce((select jsonb_agg(to_jsonb(m) order by ultimo_movimiento_at) from m where sin_movimiento), '[]'::jsonb),
    'sin_fecha', coalesce((select jsonb_agg(to_jsonb(m) order by estado_desde) from m where sin_fecha), '[]'::jsonb),
    'todos', coalesce((select jsonb_agg(to_jsonb(m) order by m.vencido desc, m.fecha_prometida nulls last) from m), '[]'::jsonb)
  ));
end;
$$;

grant execute on function :"schema".proyectos_abiertos_metricas(), :"schema".proyectos_tareas_equipo(),
  :"schema".proyectos_dashboard_ejecutivo(date, date), :"schema".proyectos_dashboard_pm(uuid) to authenticated, service_role;
