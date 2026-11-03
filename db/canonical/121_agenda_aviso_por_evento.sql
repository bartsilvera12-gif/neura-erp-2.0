-- =============================================================================
-- Agenda: aviso elegido en cada evento (pedido del dueño, 3-nov-2026).
-- "Avisarme" del formulario se guarda en agenda_citas.metadata.aviso_min (minutos antes del
-- inicio; null = sin aviso; sin la clave = los avisos de siempre, 60 y 30 min antes).
-- La campanita ahora devuelve el metadata de cada cita para calcular ese aviso.
-- IDEMPOTENTE. Va después de 91.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create or replace function notificaciones_campanita(
  p_usuario uuid,
  p_solo_no_leidas boolean default false,
  p_desde timestamptz default null,
  p_hasta timestamptz default null
) returns jsonb
 language sql
 stable
 set search_path to :"schema", public
as $function$
  with emp as (select empresa_actual() as id)
  select jsonb_build_object(
    'notificaciones', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id)
        from (select n.id, n.tipo, n.bandeja, n.titulo, n.cuerpo, n.url, n.leida_at, n.created_at
                from usuario_notificaciones n, emp
               where n.empresa_id = emp.id and n.usuario_id = p_usuario
                 and (not coalesce(p_solo_no_leidas, false) or n.leida_at is null)
               order by n.created_at desc
               limit 50) x), '[]'::jsonb),
    'general', (select count(*) from usuario_notificaciones n, emp
                 where n.empresa_id = emp.id and n.usuario_id = p_usuario and n.leida_at is null and n.bandeja <> 'soporte'),
    'soporte', (select count(*) from usuario_notificaciones n, emp
                 where n.empresa_id = emp.id and n.usuario_id = p_usuario and n.leida_at is null and n.bandeja = 'soporte'),
    'citas', case when p_desde is null or p_hasta is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'titulo', c.titulo, 'inicio_at', c.inicio_at, 'estado', c.estado,
               'responsable_id', c.responsable_id, 'created_by', c.created_by, 'ubicacion', c.ubicacion,
               'metadata', coalesce(c.metadata, '{}'::jsonb),
               'responsables', coalesce((select jsonb_agg(r.usuario_id)
                                           from agenda_cita_responsables r
                                          where r.cita_id = c.id and r.empresa_id = emp.id), '[]'::jsonb)))
        from agenda_citas c, emp
       where c.empresa_id = emp.id and c.inicio_at >= p_desde and c.inicio_at <= p_hasta
         and c.estado not in ('cancelada', 'reprogramada')), '[]'::jsonb) end
  )
$function$;
revoke all on function notificaciones_campanita(uuid, boolean, timestamptz, timestamptz) from public, anon;
grant execute on function notificaciones_campanita(uuid, boolean, timestamptz, timestamptz) to authenticated, service_role;

commit;
