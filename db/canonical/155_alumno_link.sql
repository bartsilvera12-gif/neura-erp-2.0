-- =============================================================================
-- Asistencia: cada alumno tiene SU link (pedido del dueño, 5-nov-2026: "el alumno debe poder marcar de
-- forma remota o agendar su asistencia"). Va después de 154. Reemplaza el link de la empresa + CI + PIN
-- de la receta 153, que era incómodo para la recepción (crear y dar un PIN a cada uno) y para el alumno.
--
--   · La recepción manda a cada alumno su link (/a/<token>) por WhatsApp desde su card. Sin CI, sin PIN.
--   · Con su link el alumno ve sus clases de hoy y de los próximos 6 días y:
--       - Reserva una clase grupal que todavía no empezó (si hay lugar) → queda confirmada.
--       - Cancela su reserva mientras la clase no empezó.
--       - Marca su asistencia desde donde esté: en una clase de hoy, desde 1 hora antes de que empiece
--         (si no estaba anotado se anota, si hay lugar), o "Entrada libre" una vez por día.
--         Marcar ya la culmina: descuenta la membresía o queda la clase suelta para pagar.
--   · Con una cuota vencida (y la empresa frenando a morosos) puede reservar pero no marcar: "pasá por recepción".
--   · El link viejo de la empresa (153) deja de servir para marcar: la página avisa que pidan el suyo.
--     El PIN se va: se borran sus funciones y la tabla gim_alumno_pin (solo tenía datos de prueba).
--
-- IDEMPOTENTE.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

create table if not exists :"schema".gim_alumno_link (
  cliente_id uuid primary key references :"schema".clientes(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{48}$'),
  created_at timestamptz not null default now(),
  created_by uuid references :"schema".usuarios(id) on delete set null
);
create index if not exists gim_alumno_link_empresa_idx on :"schema".gim_alumno_link (empresa_id);
alter table :"schema".gim_alumno_link enable row level security;
alter table :"schema".gim_alumno_link force row level security;
revoke all on :"schema".gim_alumno_link from public, anon, authenticated;
grant all on :"schema".gim_alumno_link to service_role;

-- ── Se va el PIN (153) ──────────────────────────────────────────────────────────────────────
drop function if exists :"schema".gim_publico_entrar(text, text, text);
drop function if exists :"schema".gim_publico_marcar(text, text, text, uuid);
drop function if exists :"schema".gim_publico_alumno(text, text, text);
drop function if exists :"schema".gim_publico_alumno_json(uuid, uuid);
drop function if exists :"schema".gim_alumno_pin_crear(uuid);

-- gim_cliente: "tiene_link" en vez de "tiene_pin" (antes de borrar la tabla, que la nombra).
do $do$
declare
  v_def text := pg_get_functiondef('gim_cliente(uuid)'::regprocedure);
  v_viejo text := $a$'tiene_pin', exists (select 1 from gim_alumno_pin p where p.cliente_id = cl.id), -- 153$a$;
  v_ancla text := $a$'bloqueado', c.bloquear_morosos and v_vencida > 0,$a$;
begin
  if position('tiene_link' in v_def) = 0 then
    if position(v_viejo in v_def) > 0 then
      v_def := replace(v_def, v_viejo, $b$'tiene_link', exists (select 1 from gim_alumno_link l where l.cliente_id = cl.id), -- 155$b$);
    elsif position(v_ancla in v_def) > 0 then
      v_def := replace(v_def, v_ancla, v_ancla || $b$
    'tiene_link', exists (select 1 from gim_alumno_link l where l.cliente_id = cl.id), -- 155$b$);
    else
      raise exception 'Receta 155: gim_cliente no tiene el patrón esperado';
    end if;
    execute v_def;
  end if;
end;
$do$;

drop table if exists :"schema".gim_alumno_pin;

-- ── Recepción: el link del alumno (se crea la primera vez; rehacer = el viejo deja de andar) ────
create or replace function :"schema".gim_alumno_link(p_cliente uuid, p_rehacer boolean default false) returns jsonb
language plpgsql security definer set search_path = :"schema", public, extensions as $fn$
declare
  s record;
  l gim_alumno_link;
  cl clientes;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  select * into cl from clientes where id = p_cliente and empresa_id = s.s_empresa;
  if cl.id is null then raise exception 'No existe ese cliente'; end if;
  select * into l from gim_alumno_link where cliente_id = p_cliente;
  if l.cliente_id is null or p_rehacer then
    insert into gim_alumno_link (cliente_id, empresa_id, token, created_by)
    values (p_cliente, s.s_empresa, encode(extensions.gen_random_bytes(24), 'hex'), s.s_usuario)
    on conflict (cliente_id) do update set token = excluded.token, created_at = now(), created_by = excluded.created_by
    returning * into l;
  end if;
  return jsonb_build_object('token', l.token, 'nombre', cl.nombre, 'telefono', cl.telefono);
end;
$fn$;

-- ── Público (anon) ───────────────────────────────────────────────────────────────────────────
-- El alumno de un link (o error si no sirve).
create or replace function :"schema".gim_link_alumno(p_token text, out o_empresa uuid, out o_cliente uuid)
language plpgsql stable security definer set search_path = :"schema", public as $fn$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then raise exception 'Este link no es válido' using errcode = '42501'; end if;
  select l.empresa_id, l.cliente_id into o_empresa, o_cliente
    from gim_alumno_link l join clientes cl on cl.id = l.cliente_id
   where l.token = p_token and cl.activo is not false;
  if o_cliente is null then raise exception 'Este link ya no es válido. Pedí el tuyo en recepción' using errcode = '42501'; end if;
  if not funcion_activa(o_empresa, 'gimnasio') then raise exception 'La asistencia no está activa' using errcode = '42501'; end if;
end;
$fn$;

-- Qué es un link: el de un alumno, el viejo de la empresa (153) o nada.
create or replace function :"schema".gim_publico_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid;
  v_tipo text := 'alumno';
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then return null; end if;
  select l.empresa_id into v_emp from gim_alumno_link l join clientes cl on cl.id = l.cliente_id where l.token = p_token and cl.activo is not false;
  if v_emp is null then
    select empresa_id into v_emp from gim_config where acceso_token = p_token;
    v_tipo := 'empresa';
  end if;
  if v_emp is null or not funcion_activa(v_emp, 'gimnasio') then return null; end if;
  return jsonb_build_object('tipo', v_tipo, 'empresa', (select coalesce(nullif(e.nombre_fantasia, ''), e.nombre) from empresas e where e.id = v_emp));
end;
$fn$;

-- Lo que ve el alumno: su estado y sus clases de hoy y de los próximos 6 días, con lo que puede hacer en cada una.
create or replace function :"schema".gim_alumno_vista(p_empresa uuid, p_cliente uuid) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  c gim_config;
  m record;
  v_hoy date := gim_hoy();
  v_desde timestamptz := v_hoy::timestamp at time zone 'America/Asuncion';
  v_bloq boolean;
begin
  c := gim_config_de(p_empresa);
  perform gim_generar(p_empresa, v_hoy, v_hoy + 6);
  select * into m from gim_membresia(p_empresa, p_cliente, v_hoy);
  v_bloq := c.bloquear_morosos and gim_deuda_vencida(p_empresa, p_cliente) > 0;
  return jsonb_build_object(
    'nombre', (select nombre from clientes where id = p_cliente),
    'bloqueado', v_bloq,
    'membresia', case when m.suscripcion_id is null then null else jsonb_build_object('plan', m.plan_nombre, 'clases_mes', m.clases_mes, 'usadas', m.usadas) end,
    'entrada_libre_hoy', exists (select 1 from gim_asistencias a where a.empresa_id = p_empresa and a.cliente_id = p_cliente and a.cita_id is null
                                    and a.fecha = v_hoy and a.estado = 'culminada'),
    'clases', coalesce((
      select jsonb_agg(x.j order by x.inicio) from (
        select ci.inicio_at as inicio, jsonb_build_object(
          'cita_id', ci.id, 'titulo', ci.titulo, 'inicio_at', ci.inicio_at, 'fin_at', ci.fin_at,
          'fecha', (ci.inicio_at at time zone 'America/Asuncion')::date,
          'profesor', (select u.nombre from usuarios u where u.id = ci.responsable_id), 'ubicacion', ci.ubicacion,
          'grupal', ci.gim_clase_id is not null,
          'estado', case when a.estado in ('cancelada', 'reagendada') then null else a.estado end,
          'lugares', lug.libres,
          'puede_reservar', ci.gim_clase_id is not null and ci.inicio_at > now()
                            and (a.id is null or a.estado in ('cancelada', 'reagendada')) and coalesce(lug.libres, 1) > 0,
          'puede_cancelar', a.estado in ('pendiente', 'confirmada') and ci.inicio_at > now(),
          'puede_marcar', not v_bloq and (ci.inicio_at at time zone 'America/Asuncion')::date = v_hoy
                          and now() >= ci.inicio_at - interval '1 hour'
                          and (a.estado in ('pendiente', 'confirmada', 'en_espera')
                               or ((a.id is null or a.estado in ('cancelada', 'reagendada')) and ci.gim_clase_id is not null and coalesce(lug.libres, 1) > 0))
        ) as j
          from agenda_citas ci
          left join gim_asistencias a on a.cita_id = ci.id and a.cliente_id = p_cliente
          cross join lateral (select case when (ci.metadata->>'gim_cupo') is null then null
                                          else (ci.metadata->>'gim_cupo')::int - (select count(*) from gim_asistencias b where b.cita_id = ci.id and b.estado not in ('cancelada', 'reagendada'))::int
                                     end as libres) lug
         where ci.empresa_id = p_empresa and ci.inicio_at >= v_desde and ci.inicio_at < v_desde + interval '7 days'
           and ci.estado <> 'cancelada'
           and (ci.gim_clase_id is not null or (ci.cliente_id = p_cliente and a.id is not null))) x), '[]'::jsonb));
end;
$fn$;

create or replace function :"schema".gim_publico_mio(p_token text) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
begin
  select * into r from gim_link_alumno(p_token);
  return jsonb_build_object('ok', true, 'alumno', gim_alumno_vista(r.o_empresa, r.o_cliente));
end;
$fn$;

-- Lo que hace el alumno con su link: reservar | cancelar | marcar (una clase de hoy) | libre (entrada libre de hoy).
create or replace function :"schema".gim_publico_accion(p_token text, p_accion text, p_cita uuid) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
  ci agenda_citas;
  a gim_asistencias;
  v_ocup int;
  v_hoy date := gim_hoy();
  v_bloq boolean;
  v_msg text;
begin
  select * into r from gim_link_alumno(p_token);
  if p_accion not in ('reservar', 'cancelar', 'marcar', 'libre') then raise exception 'Acción inválida'; end if;
  v_bloq := (gim_config_de(r.o_empresa)).bloquear_morosos and gim_deuda_vencida(r.o_empresa, r.o_cliente) > 0;
  if p_accion in ('marcar', 'libre') and v_bloq then
    return jsonb_build_object('ok', false, 'error', 'Tenés una cuota vencida sin pagar: pasá por recepción');
  end if;

  if p_accion = 'libre' then
    if exists (select 1 from gim_asistencias where empresa_id = r.o_empresa and cliente_id = r.o_cliente and cita_id is null
                 and fecha = v_hoy and estado = 'culminada') then
      return jsonb_build_object('ok', false, 'error', 'Ya marcaste tu entrada de hoy');
    end if;
    insert into gim_asistencias (empresa_id, cita_id, cliente_id, fecha, estado) values (r.o_empresa, null, r.o_cliente, v_hoy, 'pendiente')
    returning * into a;
    a := gim_asistencia_mover(r.o_empresa, null, a.id, 'culminada', false, null, false);
    return jsonb_build_object('ok', true, 'hecho', jsonb_build_object('accion', 'marcar', 'clase', 'Entrada libre',
      'cubierta', a.suscripcion_id is not null, 'valor', a.valor), 'alumno', gim_alumno_vista(r.o_empresa, r.o_cliente));
  end if;

  select * into ci from agenda_citas where id = p_cita and empresa_id = r.o_empresa for update;
  if ci.id is null or ci.estado = 'cancelada' then return jsonb_build_object('ok', false, 'error', 'Esa clase ya no está'); end if;
  if ci.gim_clase_id is null and ci.cliente_id is distinct from r.o_cliente then
    return jsonb_build_object('ok', false, 'error', 'Ese turno no es tuyo');
  end if;
  select * into a from gim_asistencias where cita_id = p_cita and cliente_id = r.o_cliente;
  if a.estado in ('cancelada', 'reagendada') then a := null; end if;

  if p_accion = 'cancelar' then
    if a.id is null or a.estado not in ('pendiente', 'confirmada') then return jsonb_build_object('ok', false, 'error', 'No tenés reserva en esa clase'); end if;
    if ci.inicio_at <= now() then return jsonb_build_object('ok', false, 'error', 'La clase ya empezó: avisá en recepción'); end if;
    perform gim_asistencia_mover(r.o_empresa, null, a.id, 'cancelada', false, null, false);
    return jsonb_build_object('ok', true, 'hecho', jsonb_build_object('accion', 'cancelar', 'clase', ci.titulo), 'alumno', gim_alumno_vista(r.o_empresa, r.o_cliente));
  end if;

  if p_accion = 'marcar' then
    if (ci.inicio_at at time zone 'America/Asuncion')::date <> v_hoy then return jsonb_build_object('ok', false, 'error', 'Esa clase no es de hoy: reservala'); end if;
    if now() < ci.inicio_at - interval '1 hour' then
      return jsonb_build_object('ok', false, 'error', 'Podés marcar desde una hora antes de la clase (' || to_char((ci.inicio_at - interval '1 hour') at time zone 'America/Asuncion', 'HH24:MI') || ')');
    end if;
    if a.estado = 'culminada' then return jsonb_build_object('ok', false, 'error', 'Ya marcaste esta clase'); end if;
    if a.estado = 'no_asistio' then return jsonb_build_object('ok', false, 'error', 'Esta clase ya está cerrada: pasá por recepción'); end if;
  else -- reservar
    if ci.gim_clase_id is null then return jsonb_build_object('ok', false, 'error', 'Los turnos individuales los agenda la recepción'); end if;
    if ci.inicio_at <= now() then return jsonb_build_object('ok', false, 'error', 'La clase ya empezó'); end if;
    if a.id is not null then return jsonb_build_object('ok', false, 'error', 'Ya tenés lugar en esa clase'); end if;
  end if;

  -- Anotarse (reservar, o marcar sin estar anotado): con lugar.
  if a.id is null then
    if ci.gim_clase_id is null then return jsonb_build_object('ok', false, 'error', 'Ese turno no es tuyo'); end if;
    if (ci.metadata->>'gim_cupo') is not null then
      select count(*) into v_ocup from gim_asistencias where cita_id = p_cita and estado not in ('cancelada', 'reagendada');
      if v_ocup >= (ci.metadata->>'gim_cupo')::int then return jsonb_build_object('ok', false, 'error', 'La clase está llena'); end if;
    end if;
    update gim_asistencias set estado = 'confirmada', updated_at = now(), updated_by = null
     where cita_id = p_cita and cliente_id = r.o_cliente returning * into a;
    if a.id is null then
      insert into gim_asistencias (empresa_id, cita_id, cliente_id, fecha, estado, profesor_id)
      values (r.o_empresa, p_cita, r.o_cliente, (ci.inicio_at at time zone 'America/Asuncion')::date, 'confirmada', ci.responsable_id)
      returning * into a;
    end if;
  elsif a.estado = 'pendiente' then
    a := gim_asistencia_mover(r.o_empresa, null, a.id, 'confirmada', false, null, false);
  end if;

  if p_accion = 'reservar' then
    return jsonb_build_object('ok', true, 'hecho', jsonb_build_object('accion', 'reservar', 'clase', ci.titulo, 'inicio_at', ci.inicio_at),
      'alumno', gim_alumno_vista(r.o_empresa, r.o_cliente));
  end if;

  begin
    a := gim_asistencia_mover(r.o_empresa, null, a.id, 'culminada', false, null, false);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    return jsonb_build_object('ok', false, 'error', v_msg);
  end;
  return jsonb_build_object('ok', true, 'hecho', jsonb_build_object('accion', 'marcar', 'clase', ci.titulo,
    'cubierta', a.suscripcion_id is not null, 'valor', a.valor), 'alumno', gim_alumno_vista(r.o_empresa, r.o_cliente));
end;
$fn$;

-- ── Permisos de ejecución ────────────────────────────────────────────────────────────────────
do $do$
declare
  f text;
begin
  foreach f in array array['gim_link_alumno(text)', 'gim_alumno_vista(uuid,uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  execute 'revoke all on function gim_alumno_link(uuid,boolean) from public, anon';
  execute 'grant execute on function gim_alumno_link(uuid,boolean) to authenticated, service_role';
  foreach f in array array['gim_publico_info(text)', 'gim_publico_mio(text)', 'gim_publico_accion(text,text,uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
