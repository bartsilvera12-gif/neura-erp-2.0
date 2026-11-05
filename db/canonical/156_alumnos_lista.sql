-- =============================================================================
-- Asistencia: la lista de alumnos de "Que el alumno marque solo" (pedido del dueño, 5-nov-2026: la
-- pantalla con un buscador solo era incómoda). Va después de 155.
--
--   · gim_alumnos_lista(buscar, filtro): cada alumno con lo último que hizo ("Marcó hoy 18:00",
--     "Reservó Yoga mañana", "Todavía no tiene su link"), si debe y si ya se le mandó el link.
--     Filtros: todos | sin_link (no se le mandó) | deben. Con los totales de cada filtro.
--   · gim_alumno_link_enviado(cliente): queda anotado que se le mandó el link (al tocar WhatsApp o Copiar).
--   · El link anota cuándo lo usó el alumno por última vez.
--
-- IDEMPOTENTE.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

alter table :"schema".gim_alumno_link add column if not exists enviado_at timestamptz;
alter table :"schema".gim_alumno_link add column if not exists usado_at timestamptz;

create or replace function :"schema".gim_alumno_link_enviado(p_cliente uuid) returns void
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  update gim_alumno_link set enviado_at = now() where cliente_id = p_cliente and empresa_id = s.s_empresa;
  if not found then raise exception 'Ese alumno todavía no tiene link'; end if;
end;
$fn$;

create or replace function :"schema".gim_alumnos_lista(p_buscar text default null, p_filtro text default 'todos') returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  c gim_config;
  v_hoy date := gim_hoy();
  v_q text := nullif(trim(coalesce(p_buscar, '')), '');
  v_qd text;
  v_filas jsonb;
  v_tot jsonb;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  if p_filtro not in ('todos', 'sin_link', 'deben') then raise exception 'Filtro inválido'; end if;
  c := gim_config_de(s.s_empresa);
  v_qd := nullif(regexp_replace(coalesce(v_q, ''), '\D', '', 'g'), '');

  with al as (
    select cl.id, cl.nombre, cl.documento, cl.telefono, l.enviado_at is not null as enviado, l.cliente_id is not null as tiene_link,
           gim_deuda_vencida(s.s_empresa, cl.id) as deuda,
           (select jsonb_build_object('clase', coalesce(ci.titulo, 'Entrada libre'), 'fecha', a.fecha, 'hora', a.culminada_at)
              from gim_asistencias a left join agenda_citas ci on ci.id = a.cita_id
             where a.cliente_id = cl.id and a.estado = 'culminada' order by a.culminada_at desc nulls last limit 1) as ultima,
           (select jsonb_build_object('clase', ci.titulo, 'inicio_at', ci.inicio_at)
              from gim_asistencias a join agenda_citas ci on ci.id = a.cita_id
             where a.cliente_id = cl.id and a.estado in ('pendiente', 'confirmada') and ci.inicio_at > now() - interval '1 hour'
             order by ci.inicio_at limit 1) as proxima,
           (select case when m.suscripcion_id is null then null
                        else jsonb_build_object('plan', m.plan_nombre, 'clases_mes', m.clases_mes, 'usadas', m.usadas) end
              from gim_membresia(s.s_empresa, cl.id, v_hoy) m) as membresia
      from clientes cl
      left join gim_alumno_link l on l.cliente_id = cl.id
     where cl.empresa_id = s.s_empresa and cl.deleted_at is null and cl.activo is not false
       and (v_q is null or norm(cl.nombre) like '%' || norm(v_q) || '%'
            or (v_qd is not null and regexp_replace(coalesce(cl.documento, '') || ' ' || coalesce(cl.telefono, ''), '\D', '', 'g') like '%' || v_qd || '%'))
  )
  select jsonb_build_object('todos', count(*), 'sin_link', count(*) filter (where not al.enviado), 'deben', count(*) filter (where al.deuda > 0)),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', x.id, 'nombre', x.nombre, 'documento', x.documento, 'telefono', x.telefono, 'enviado', x.enviado, 'tiene_link', x.tiene_link,
             'deuda_vencida', x.deuda, 'bloqueado', c.bloquear_morosos and x.deuda > 0,
             'ultima', x.ultima, 'proxima', x.proxima, 'membresia', x.membresia) order by x.nombre)
             from (select * from al a2
                    where p_filtro = 'todos' or (p_filtro = 'sin_link' and not a2.enviado) or (p_filtro = 'deben' and a2.deuda > 0)
                    order by a2.nombre limit 300) x), '[]'::jsonb)
    into v_tot, v_filas
    from al;

  return jsonb_build_object('alumnos', v_filas, 'totales', v_tot);
end;
$fn$;

-- El link anota cuándo lo usó el alumno.
do $do$
declare
  v_def text := pg_get_functiondef('gim_publico_mio(text)'::regprocedure);
  v_ancla text := $a$select * into r from gim_link_alumno(p_token);$a$;
begin
  if position('usado_at' in v_def) = 0 then
    if position(v_ancla in v_def) = 0 then raise exception 'Receta 156: gim_publico_mio no tiene el patrón esperado'; end if;
    execute replace(v_def, v_ancla, v_ancla || $b$
  update gim_alumno_link set usado_at = now() where token = p_token; -- 156$b$);
  end if;
end;
$do$;

revoke all on function :"schema".gim_alumno_link_enviado(uuid) from public, anon;
grant execute on function :"schema".gim_alumno_link_enviado(uuid) to authenticated, service_role;
revoke all on function :"schema".gim_alumnos_lista(text, text) from public, anon;
grant execute on function :"schema".gim_alumnos_lista(text, text) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
