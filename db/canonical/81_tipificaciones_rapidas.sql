-- =============================================================================
-- TIPIFICACIONES RÁPIDAS — pedido del dueño, 27-oct-2026 ("lento y tosco").
--
-- Antes, el historial de un cliente salía de 9 consultas en dos tandas (tipificaciones →
-- después tickets y citas) y no había un registro de TODAS las tipificaciones. Ahora:
--
--   tipificaciones_registro(p jsonb) → { total, filas[] }
--     p: { q, desde (YYYY-MM-DD), hasta, familia (uuid), usuario (uuid), accion
--          ('ticket' | 'capacitacion' | 'ninguna'), cliente (uuid), id (una sola), limite (1–200, 50),
--          offset }
--     fila: { id, fecha, usuario, usuario_id, tipo_gestion, resultado, observacion, familia_id,
--             estado_id, cliente {id, nombre, codigo, ruc, documento},
--             ticket {id, numero, asunto, estado_codigo, estado_nombre, estado_color,
--                     prioridad_codigo, prioridad_nombre} | null,
--             cita {id, inicio_at, fin_at, estado, responsable} | null }
--     Una sola consulta: el ticket y la capacitación vinculados vienen con su estado de AHORA.
--     Búsqueda inteligente (19/58): cada palabra en cliente (nombre, RUC, teléfono, código),
--     estado, sub-estado, observación, usuario o número de ticket (#12 / 0012), sin tildes y
--     tolerando errores de tipeo. Fechas en hora de Paraguay. Orden: más nuevas primero.
--
-- Índices: registro por empresa y fecha; capacitación por tipificación (metadata).
-- SECURITY INVOKER + empresa_actual() (RLS de la sesión). IDEMPOTENTE. Va después de 80.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create index if not exists tipif_empresa_fecha_idx on :"schema".tipificaciones (empresa_id, fecha desc, id desc);
create index if not exists agenda_tipificacion_idx on :"schema".agenda_citas ((metadata ->> 'tipificacion_id'))
  where metadata ? 'tipificacion_id';

create or replace function :"schema".tipificaciones_registro(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_q text := nullif(trim(coalesce(p ->> 'q', '')), '');
  v_tokens text[];
  v_num integer;
  v_solo_num boolean := false;
  v_desde date := nullif(p ->> 'desde', '')::date;
  v_hasta date := nullif(p ->> 'hasta', '')::date;
  v_familia uuid := nullif(p ->> 'familia', '')::uuid;
  v_usuario uuid := nullif(p ->> 'usuario', '')::uuid;
  v_cliente uuid := nullif(p ->> 'cliente', '')::uuid;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_accion text := nullif(p ->> 'accion', '');
  v_limite integer := least(greatest(coalesce(nullif(p ->> 'limite', '')::integer, 50), 1), 200);
  v_offset integer := greatest(coalesce(nullif(p ->> 'offset', '')::integer, 0), 0);
  r jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  if v_q is not null then
    v_tokens := tokens_busqueda(v_q);
    -- "#12", "0012", "ticket 12": número de ticket exacto.
    -- Con "#" o "ticket" delante es SOLO ese ticket; un número suelto también busca en el texto.
    if v_q ~* '^\s*(#|ticket\s*)?0*[0-9]{1,7}\s*$' then
      v_num := nullif(regexp_replace(v_q, '[^0-9]', '', 'g'), '')::integer;
      v_solo_num := v_q ~* '^\s*(#|ticket)';
    end if;
  end if;

  with base as (
    select t.id, t.fecha, t.usuario, t.usuario_id, t.tipo_gestion, t.resultado, t.observacion,
           t.familia_id, t.estado_id, t.cliente_id,
           c.nombre as c_nombre, c.codigo as c_codigo, c.ruc as c_ruc, c.documento as c_documento,
           c.busqueda as c_busqueda,
           tk.id as tk_id, tk.numero as tk_numero, tk.asunto as tk_asunto,
           tk.estado_codigo as tk_estado, tk.prioridad_codigo as tk_prioridad,
           ci.id as ci_id, ci.inicio_at as ci_inicio, ci.fin_at as ci_fin, ci.estado as ci_estado,
           ci.responsable_id as ci_resp
      from tipificaciones t
      join clientes c on c.id = t.cliente_id
      left join soporte_tickets tk on tk.tipificacion_id = t.id and tk.empresa_id = v_emp
      left join lateral (
        select a.id, a.inicio_at, a.fin_at, a.estado, a.responsable_id
          from agenda_citas a
         where a.metadata ? 'tipificacion_id' and a.metadata ->> 'tipificacion_id' = t.id::text
           and a.empresa_id = v_emp
         order by a.created_at desc
         limit 1
      ) ci on true
     where t.empresa_id = v_emp
       and (v_id is null or t.id = v_id)
       and (v_cliente is null or t.cliente_id = v_cliente)
       and (v_desde is null or t.fecha >= v_desde::timestamp at time zone 'America/Asuncion')
       and (v_hasta is null or t.fecha < (v_hasta + 1)::timestamp at time zone 'America/Asuncion')
       and (v_familia is null or t.familia_id = v_familia)
       and (v_usuario is null or t.usuario_id = v_usuario)
  ),
  filtradas as (
    select b.*
      from base b
     where (v_accion is null
            or (v_accion = 'ticket' and b.tk_id is not null)
            or (v_accion = 'capacitacion' and b.ci_id is not null)
            or (v_accion = 'ninguna' and b.tk_id is null and b.ci_id is null))
       and (v_q is null
            or (v_num is not null and b.tk_numero = v_num)
            or (not v_solo_num and coincide_busqueda(
                 concat_ws(' ', coalesce(b.c_busqueda, norm(b.c_nombre)), norm(b.c_codigo), compacto(b.c_ruc),
                           norm(b.tipo_gestion), norm(b.resultado), norm(b.observacion), norm(b.usuario),
                           case when b.tk_numero is not null then 'ticket ' || b.tk_numero || ' ' || lpad(b.tk_numero::text, 4, '0') end,
                           norm(b.tk_asunto)),
                 v_tokens)))
  ),
  pagina as (
    select f.*, count(*) over () as total
      from filtradas f
     order by f.fecha desc, f.id desc
     limit v_limite offset v_offset
  )
  select jsonb_build_object(
           'total', coalesce(max(pg.total), 0),
           'filas', coalesce(jsonb_agg(jsonb_build_object(
             'id', pg.id, 'fecha', pg.fecha, 'usuario', pg.usuario, 'usuario_id', pg.usuario_id,
             'tipo_gestion', pg.tipo_gestion, 'resultado', pg.resultado, 'observacion', coalesce(pg.observacion, ''),
             'familia_id', pg.familia_id, 'estado_id', pg.estado_id,
             'cliente', jsonb_build_object('id', pg.cliente_id, 'nombre', pg.c_nombre, 'codigo', pg.c_codigo,
                                           'ruc', pg.c_ruc, 'documento', pg.c_documento),
             'ticket', case when pg.tk_id is null then null else jsonb_build_object(
               'id', pg.tk_id, 'numero', pg.tk_numero, 'asunto', coalesce(pg.tk_asunto, ''),
               'estado_codigo', pg.tk_estado, 'estado_nombre', coalesce(se.nombre, pg.tk_estado), 'estado_color', se.color,
               'prioridad_codigo', pg.tk_prioridad, 'prioridad_nombre', coalesce(sp.nombre, pg.tk_prioridad)) end,
             'cita', case when pg.ci_id is null then null else jsonb_build_object(
               'id', pg.ci_id, 'inicio_at', pg.ci_inicio, 'fin_at', pg.ci_fin, 'estado', pg.ci_estado,
               'responsable', u.nombre) end
           ) order by pg.fecha desc, pg.id desc), '[]'::jsonb)
         )
    into r
    from pagina pg
    left join soporte_estados se on se.empresa_id = v_emp and se.codigo = pg.tk_estado
    left join soporte_prioridades sp on sp.empresa_id = v_emp and sp.codigo = pg.tk_prioridad
    left join usuarios u on u.id = pg.ci_resp;
  return r;
end;
$fn$;
revoke all on function :"schema".tipificaciones_registro(jsonb) from public, anon;
grant execute on function :"schema".tipificaciones_registro(jsonb) to authenticated, service_role;

commit;
