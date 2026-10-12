-- =============================================================================
-- PROYECTOS — extra (OPCIONAL, sin aplicar todavía).
--   · proyectos_tarjetas devuelve además fecha_ingreso, cancelacion_motivo,
--     bloqueo_responsable y bloqueo_proxima_accion: la tarjeta del tablero muestra
--     "Ingreso", el motivo de la cancelación y quién destraba / próxima acción del
--     bloqueo (como el sistema actual). Misma firma y mismo tipo de retorno: el front
--     funciona igual con o sin este archivo (sin él, esos datos se ven en el detalle).
-- IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;

create or replace function :"schema".proyectos_tarjetas(
  p_estado uuid, p_q text, p_responsable uuid, p_cliente uuid, p_prioridad text, p_archivados boolean,
  p_cursor_at timestamptz, p_cursor_id uuid, p_limite integer
) returns jsonb language sql stable security invoker set search_path = :"schema", public as $$
  select coalesce(jsonb_agg(t order by t.ultimo_movimiento_at desc, t.id desc), '[]'::jsonb) from (
    select p.id, p.numero, p.titulo, p.prioridad, p.estado_id, p.estado_desde, p.ultimo_movimiento_at,
           p.fecha_ingreso, p.fecha_prometida, p.fecha_entrega, p.monto_vendido, p.moneda,
           p.bloqueado, p.bloqueo_tipo, p.bloqueo_motivo, p.bloqueo_responsable, p.bloqueo_proxima_accion,
           p.pausa_motivo, p.cancelacion_motivo, p.cliente_id, c.nombre as cliente_nombre,
           p.responsable_comercial_id, uc.nombre as comercial_nombre,
           p.responsable_tecnico_id, ut.nombre as tecnico_nombre,
           p.project_manager_id, up.nombre as pm_nombre,
           (select count(*) from proyecto_tareas x where x.proyecto_id = p.id) as tareas_total,
           (select count(*) from proyecto_tareas x where x.proyecto_id = p.id and x.estado = 'completada') as tareas_hechas
      from proyectos p
      left join clientes c on c.id = p.cliente_id
      left join usuarios uc on uc.id = p.responsable_comercial_id
      left join usuarios ut on ut.id = p.responsable_tecnico_id
      left join usuarios up on up.id = p.project_manager_id
     where p.empresa_id = empresa_actual() and p.estado_id = p_estado
       and p.archivado = coalesce(p_archivados, false)
       and (p_responsable is null or p_responsable in (p.responsable_tecnico_id, p.responsable_comercial_id, p.project_manager_id))
       and (p_cliente is null or p.cliente_id = p_cliente)
       and (p_prioridad is null or p.prioridad = p_prioridad)
       and (p_cursor_at is null or (p.ultimo_movimiento_at, p.id) < (p_cursor_at, p_cursor_id))
       and (coalesce(trim(p_q), '') = '' or p.id in (select proyectos_candidatos(p_q)))
     order by p.ultimo_movimiento_at desc, p.id desc
     limit least(greatest(coalesce(p_limite, 30), 1), 100)) t
$$;

grant execute on function :"schema".proyectos_tarjetas(uuid, text, uuid, uuid, text, boolean, timestamptz, uuid, integer) to authenticated, service_role;
