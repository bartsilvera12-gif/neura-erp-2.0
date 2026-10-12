-- =============================================================================
-- CRM · vista Lista: una página de prospectos (todas las etapas o una), con los mismos
-- filtros que crm_tablero / crm_columna y cursor keyset (updated_at desc, id desc).
-- La API /api/crm la usa si existe; si no está aplicada, la API cae a un select con
-- crm_candidatos (que corta la búsqueda en las primeras coincidencias).
-- IDEMPOTENTE. Requiere 34_crm.sql.
-- =============================================================================
set search_path = :"schema", public, extensions;

-- La lista sin filtro de etapa recorre por fecha de actualización (el índice de 34 empieza por etapa).
create index if not exists crm_pros_actualizado_idx on :"schema".crm_prospectos (empresa_id, updated_at desc, id desc);

create or replace function :"schema".crm_lista(
  p_q text default null, p_responsable uuid default null, p_solo_mios boolean default false,
  p_hoy boolean default false, p_etapa text default null,
  p_cursor_at timestamptz default null, p_cursor_id uuid default null, p_limite integer default 25
) returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $$
declare
  v_yo uuid;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  select id into v_yo from usuarios where auth_user_id = auth.uid() limit 1;
  return coalesce((select jsonb_agg(t order by t.updated_at desc, t.id desc) from (
    select p.id, p.numero_control, p.empresa, p.contacto, p.telefono, p.email, p.servicio, p.valor_estimado,
           p.etapa, p.proxima_accion, p.fecha_proxima_accion, p.origen_creacion, p.responsable_usuario_id,
           u.nombre as responsable_nombre, p.cliente_id, p.updated_at, p.created_at, p.etapa_desde,
           (p.fecha_proxima_accion is not null and p.fecha_proxima_accion < v_hoy) as accion_vencida
      from crm_prospectos p left join usuarios u on u.id = p.responsable_usuario_id
     where p.empresa_id = empresa_actual()
       and (coalesce(p_etapa, '') = '' or p.etapa = p_etapa)
       and (p_cursor_at is null or (p.updated_at, p.id) < (p_cursor_at, p_cursor_id))
       and (p_responsable is null or p.responsable_usuario_id = p_responsable)
       and (not coalesce(p_solo_mios, false) or p.responsable_usuario_id = v_yo)
       and (not coalesce(p_hoy, false) or (p.created_at at time zone 'America/Asuncion')::date = v_hoy)
       and (coalesce(trim(p_q), '') = '' or p.id in (select crm_candidatos(p_q)))
     order by p.updated_at desc, p.id desc
     limit least(greatest(coalesce(p_limite, 25), 1), 100)) t), '[]'::jsonb);
end;
$$;

grant execute on function :"schema".crm_lista(text, uuid, boolean, boolean, text, timestamptz, uuid, integer)
  to authenticated, service_role;
