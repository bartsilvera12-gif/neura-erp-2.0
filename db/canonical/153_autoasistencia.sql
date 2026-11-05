-- =============================================================================
-- Asistencia: el alumno marca su llegada solo (pedido del dueño, 5-nov-2026). Va después de 152.
--
--   · Un link por empresa (/a/<token>) que se comparte o se imprime como QR. El alumno pone su CI y
--     su PIN de 4 números (lo crea la recepción en su card de Asistencia) y marca la llegada a una
--     clase de hoy (se anota si hay lugar) o a la sala (entrada libre).
--   · Marcar la llegada ya la culmina: descuenta la membresía o queda la clase suelta a cobrar.
--   · Con deuda vencida (y la empresa frenando a morosos) no entra: "pasá por recepción".
--   · 5 PIN mal = 15 minutos bloqueado ese alumno. CI o PIN mal dan el mismo mensaje.
--   · La lógica de cambiar el estado pasa a gim_asistencia_mover (sin sesión), que usan la
--     recepción (gim_asistencia_estado, con sesión y permiso) y el link público.
--
-- IDEMPOTENTE.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

alter table :"schema".gim_config add column if not exists acceso_token text;
create unique index if not exists gim_config_acceso_token_uq on :"schema".gim_config (acceso_token) where acceso_token is not null;

create table if not exists :"schema".gim_alumno_pin (
  cliente_id uuid primary key references :"schema".clientes(id) on delete cascade,
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  pin_hash text not null,
  intentos_fallidos smallint not null default 0,
  bloqueado_hasta timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references :"schema".usuarios(id) on delete set null
);
alter table :"schema".gim_alumno_pin enable row level security;
alter table :"schema".gim_alumno_pin force row level security;
revoke all on :"schema".gim_alumno_pin from public, anon, authenticated;
grant all on :"schema".gim_alumno_pin to service_role;

-- ── Núcleo sin sesión: cambiar el estado de una asistencia ─────────────────────────────────
create or replace function :"schema".gim_asistencia_mover(p_empresa uuid, p_usuario uuid, p_id uuid, p_estado text,
  p_forzar boolean, p_motivo text, p_puede_forzar boolean)
returns gim_asistencias language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  c gim_config;
  a gim_asistencias;
  ci agenda_citas;
  m record;
  v_vencida numeric;
  v_precio numeric;
  v_detalle text;
  v_venta uuid;
  v_valor numeric;
  v_cubre boolean;
begin
  c := gim_config_de(p_empresa);
  if p_estado not in ('pendiente', 'confirmada', 'cancelada', 'reagendada', 'en_espera', 'culminada', 'no_asistio') then
    raise exception 'Estado inválido';
  end if;
  select * into a from gim_asistencias where id = p_id and empresa_id = p_empresa for update;
  if a.id is null then raise exception 'No existe esa asistencia'; end if;
  if a.estado = p_estado then return a; end if;
  if a.estado in ('culminada', 'no_asistio', 'cancelada', 'reagendada') then
    raise exception 'Esa asistencia ya está cerrada (%)', replace(a.estado, '_', ' ');
  end if;
  if a.estado = 'en_espera' and p_estado in ('pendiente', 'confirmada') then raise exception 'Ya llegó: marcala culminada o no asistió'; end if;
  if a.cita_id is not null then select * into ci from agenda_citas where id = a.cita_id; end if;

  -- Entrada: deuda vencida.
  if p_estado in ('en_espera', 'culminada') and a.llegada_at is null then
    v_vencida := gim_deuda_vencida(p_empresa, a.cliente_id);
    if c.bloquear_morosos and v_vencida > 0 then
      if not p_forzar then
        raise exception 'Tiene una deuda vencida de Gs. %: que pase por caja antes de entrar', replace(to_char(v_vencida, 'FM999,999,999,999'), ',', '.')
          using hint = 'moroso:' || v_vencida;
      end if;
      if not p_puede_forzar then
        raise exception 'Tiene deuda vencida y no tenés permiso para dejarlo entrar' using errcode = '42501';
      end if;
      if coalesce(trim(p_motivo), '') = '' then raise exception 'Poné el motivo para dejarlo entrar con deuda'; end if;
      update gim_asistencias set forzada = true, forzada_por = p_usuario, forzada_motivo = trim(p_motivo) where id = a.id;
    end if;
    update gim_asistencias set llegada_at = now() where id = a.id;
  end if;

  if p_estado = 'culminada' then
    select * into m from gim_membresia(p_empresa, a.cliente_id, a.fecha);
    v_cubre := m.suscripcion_id is not null and (m.clases_mes is null or m.usadas < m.clases_mes);
    if v_cubre then
      if m.clases_mes is not null then v_valor := round(m.precio / m.clases_mes); end if;
      update gim_asistencias set suscripcion_id = m.suscripcion_id, valor = v_valor where id = a.id;
    else
      v_precio := coalesce((select g.precio_suelta from gim_clases g where g.id = ci.gim_clase_id), c.precio_clase_suelta);
      if v_precio > 0 then
        v_detalle := 'Clase suelta: ' || coalesce(ci.titulo, 'Entrada libre') || ' — ' || to_char(a.fecha, 'DD/MM/YYYY');
        v_venta := gim_cobrar_suelta(p_empresa, a.cliente_id, v_detalle, v_precio, c.tipo_iva);
      end if;
      update gim_asistencias set venta_id = v_venta, valor = v_precio where id = a.id;
    end if;
    update gim_asistencias set culminada_at = now(), profesor_id = coalesce(ci.responsable_id, profesor_id) where id = a.id;
  end if;

  update gim_asistencias set estado = p_estado, updated_at = now(), updated_by = p_usuario where id = a.id returning * into a;

  -- Turno individual: la cita de la Agenda sigue al alumno.
  if ci.id is not null and ci.gim_clase_id is null then
    update agenda_citas set estado = case p_estado when 'reagendada' then 'reprogramada' when 'culminada' then 'completada' else p_estado end,
           updated_at = now()
     where id = ci.id;
  end if;
  return a;
end;
$fn$;

-- La recepción (con sesión y permiso): igual que antes, ahora sobre el núcleo.
create or replace function :"schema".gim_asistencia_estado(p_id uuid, p_estado text, p_forzar boolean default false, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  return gim_asistencia_json(gim_asistencia_mover(s.s_empresa, s.s_usuario, p_id, p_estado, p_forzar, p_motivo, tiene_permiso('gimnasio_forzar_entrada')));
end;
$fn$;

-- ── Link de autoasistencia y PIN de cada alumno (recepción / administrador) ─────────────────
create or replace function :"schema".gim_autoasistencia_link(p_rehacer boolean default false) returns jsonb
language plpgsql security definer set search_path = :"schema", public, extensions as $fn$
declare
  s record;
  c gim_config;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  c := gim_config_de(s.s_empresa);
  if p_rehacer and not tiene_permiso('gimnasio_administrar') then
    raise exception 'Solo quien administra Asistencia puede cambiar el link' using errcode = '42501';
  end if;
  if c.acceso_token is null or p_rehacer then
    update gim_config set acceso_token = encode(extensions.gen_random_bytes(24), 'hex'), updated_at = now(), updated_by = s.s_usuario
     where empresa_id = s.s_empresa returning * into c;
  end if;
  return jsonb_build_object('token', c.acceso_token, 'puede_cambiar', tiene_permiso('gimnasio_administrar'));
end;
$fn$;

create or replace function :"schema".gim_alumno_pin_crear(p_cliente uuid) returns jsonb
language plpgsql security definer set search_path = :"schema", public, extensions as $fn$
declare
  s record;
  v_pin text;
begin
  select * into s from gim_sesion('gimnasio_recepcion');
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = s.s_empresa) then raise exception 'No existe ese cliente'; end if;
  if coalesce((select regexp_replace(coalesce(documento, ''), '\D', '', 'g') from clientes where id = p_cliente), '') = '' then
    raise exception 'Cargale la CI al alumno primero: con la CI y el PIN marca su asistencia';
  end if;
  v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
  insert into gim_alumno_pin (cliente_id, empresa_id, pin_hash, updated_by)
  values (p_cliente, s.s_empresa, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), s.s_usuario)
  on conflict (cliente_id) do update set pin_hash = excluded.pin_hash, intentos_fallidos = 0, bloqueado_hasta = null,
                                         updated_at = now(), updated_by = excluded.updated_by;
  return jsonb_build_object('pin', v_pin);
end;
$fn$;

-- gim_cliente: además dice si el alumno ya tiene PIN.
do $do$
declare
  v_def text := pg_get_functiondef('gim_cliente(uuid)'::regprocedure);
  v_ancla text := $a$'bloqueado', c.bloquear_morosos and v_vencida > 0,$a$;
begin
  if position('tiene_pin' in v_def) = 0 then
    if position(v_ancla in v_def) = 0 then raise exception 'Receta 153: gim_cliente no tiene el patrón esperado'; end if;
    execute replace(v_def, v_ancla, v_ancla || $b$
    'tiene_pin', exists (select 1 from gim_alumno_pin p where p.cliente_id = cl.id), -- 153$b$);
  end if;
end;
$do$;

-- ── Público (anon): el link + CI + PIN ───────────────────────────────────────────────────────
-- El alumno del link, o null si la CI o el PIN no coinciden (cuenta el intento fallido).
create or replace function :"schema".gim_publico_alumno(p_token text, p_documento text, p_pin text,
  out o_empresa uuid, out o_cliente uuid)
language plpgsql security definer set search_path = :"schema", public, extensions as $fn$
declare
  v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  p gim_alumno_pin;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then raise exception 'Este link no es válido' using errcode = '42501'; end if;
  select empresa_id into o_empresa from gim_config where acceso_token = p_token;
  if o_empresa is null then raise exception 'Este link ya no es válido. Pedí el nuevo en recepción' using errcode = '42501'; end if;
  if not funcion_activa(o_empresa, 'gimnasio') then raise exception 'La asistencia no está activa' using errcode = '42501'; end if;
  if length(v_doc) < 4 then return; end if;
  select pp.* into p from gim_alumno_pin pp join clientes cl on cl.id = pp.cliente_id
   where pp.empresa_id = o_empresa and cl.activo is not false and regexp_replace(coalesce(cl.documento, ''), '\D', '', 'g') = v_doc
   order by pp.updated_at desc limit 1 for update of pp;
  if p.cliente_id is null then return; end if;
  if p.bloqueado_hasta is not null and p.bloqueado_hasta > now() then
    raise exception 'Demasiados PIN incorrectos. Probá de nuevo en unos minutos' using errcode = '42501';
  end if;
  if extensions.crypt(coalesce(p_pin, ''), p.pin_hash) <> p.pin_hash then
    update gim_alumno_pin set intentos_fallidos = intentos_fallidos + 1,
           bloqueado_hasta = case when intentos_fallidos + 1 >= 5 then now() + interval '15 minutes' end
     where cliente_id = p.cliente_id;
    return;
  end if;
  if p.intentos_fallidos > 0 then update gim_alumno_pin set intentos_fallidos = 0, bloqueado_hasta = null where cliente_id = p.cliente_id; end if;
  o_cliente := p.cliente_id;
end;
$fn$;

create or replace function :"schema".gim_publico_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  v_emp uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then return null; end if;
  select empresa_id into v_emp from gim_config where acceso_token = p_token;
  if v_emp is null or not funcion_activa(v_emp, 'gimnasio') then return null; end if;
  return jsonb_build_object('empresa', (select coalesce(nullif(e.nombre_fantasia, ''), e.nombre) from empresas e where e.id = v_emp));
end;
$fn$;

-- Lo que ve el alumno: su estado y las clases de hoy (las suyas y las que tienen lugar).
create or replace function :"schema".gim_publico_alumno_json(p_empresa uuid, p_cliente uuid) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  c gim_config;
  m record;
  v_hoy date := gim_hoy();
  v_desde timestamptz := v_hoy::timestamp at time zone 'America/Asuncion';
begin
  c := gim_config_de(p_empresa);
  perform gim_generar(p_empresa, v_hoy, v_hoy);
  select * into m from gim_membresia(p_empresa, p_cliente, v_hoy);
  return jsonb_build_object(
    'nombre', (select nombre from clientes where id = p_cliente),
    'bloqueado', c.bloquear_morosos and gim_deuda_vencida(p_empresa, p_cliente) > 0,
    'membresia', case when m.suscripcion_id is null then null else jsonb_build_object('plan', m.plan_nombre, 'clases_mes', m.clases_mes, 'usadas', m.usadas) end,
    'entrada_libre_hoy', exists (select 1 from gim_asistencias a where a.empresa_id = p_empresa and a.cliente_id = p_cliente and a.cita_id is null
                                    and a.fecha = v_hoy and a.estado = 'culminada'),
    'clases', coalesce((
      select jsonb_agg(x.j order by x.inicio) from (
        select ci.inicio_at as inicio, jsonb_build_object(
          'cita_id', ci.id, 'titulo', ci.titulo, 'inicio_at', ci.inicio_at, 'fin_at', ci.fin_at,
          'profesor', (select u.nombre from usuarios u where u.id = ci.responsable_id), 'ubicacion', ci.ubicacion,
          'estado', a.estado,
          'lugares', case when (ci.metadata->>'gim_cupo') is null then null
                          else (ci.metadata->>'gim_cupo')::int - (select count(*) from gim_asistencias b where b.cita_id = ci.id and b.estado not in ('cancelada', 'reagendada')) end) as j
          from agenda_citas ci
          left join gim_asistencias a on a.cita_id = ci.id and a.cliente_id = p_cliente
         where ci.empresa_id = p_empresa and ci.inicio_at >= v_desde and ci.inicio_at < v_desde + interval '1 day'
           and ci.estado <> 'cancelada' and ci.fin_at > now() - interval '30 minutes'
           and (ci.gim_clase_id is not null or a.id is not null)
           and (ci.gim_clase_id is not null or ci.cliente_id = p_cliente)) x), '[]'::jsonb));
end;
$fn$;

create or replace function :"schema".gim_publico_entrar(p_token text, p_documento text, p_pin text) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
begin
  select * into r from gim_publico_alumno(p_token, p_documento, p_pin);
  if r.o_cliente is null then return jsonb_build_object('ok', false, 'error', 'La CI o el PIN no coinciden'); end if;
  return jsonb_build_object('ok', true, 'alumno', gim_publico_alumno_json(r.o_empresa, r.o_cliente));
end;
$fn$;

-- Marca la llegada: a una clase de hoy (se anota si no estaba y hay lugar) o a la sala (p_cita null).
create or replace function :"schema".gim_publico_marcar(p_token text, p_documento text, p_pin text, p_cita uuid) returns jsonb
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
  ci agenda_citas;
  a gim_asistencias;
  v_ocup int;
  v_hoy date := gim_hoy();
begin
  select * into r from gim_publico_alumno(p_token, p_documento, p_pin);
  if r.o_cliente is null then return jsonb_build_object('ok', false, 'error', 'La CI o el PIN no coinciden'); end if;
  if (gim_config_de(r.o_empresa)).bloquear_morosos and gim_deuda_vencida(r.o_empresa, r.o_cliente) > 0 then
    return jsonb_build_object('ok', false, 'error', 'Tenés una cuota vencida sin pagar: pasá por recepción');
  end if;

  if p_cita is null then
    if exists (select 1 from gim_asistencias where empresa_id = r.o_empresa and cliente_id = r.o_cliente and cita_id is null
                 and fecha = v_hoy and estado = 'culminada') then
      return jsonb_build_object('ok', false, 'error', 'Ya marcaste tu entrada de hoy');
    end if;
    insert into gim_asistencias (empresa_id, cita_id, cliente_id, fecha, estado) values (r.o_empresa, null, r.o_cliente, v_hoy, 'pendiente')
    returning * into a;
  else
    select * into ci from agenda_citas where id = p_cita and empresa_id = r.o_empresa for update;
    if ci.id is null or ci.estado = 'cancelada' or (ci.inicio_at at time zone 'America/Asuncion')::date <> v_hoy then
      return jsonb_build_object('ok', false, 'error', 'Esa clase no es de hoy');
    end if;
    if ci.gim_clase_id is null and ci.cliente_id is distinct from r.o_cliente then
      return jsonb_build_object('ok', false, 'error', 'Ese turno no es tuyo');
    end if;
    select * into a from gim_asistencias where cita_id = p_cita and cliente_id = r.o_cliente;
    if a.id is null or a.estado in ('cancelada', 'reagendada') then
      if (ci.metadata->>'gim_cupo') is not null then
        select count(*) into v_ocup from gim_asistencias where cita_id = p_cita and estado not in ('cancelada', 'reagendada');
        if v_ocup >= (ci.metadata->>'gim_cupo')::int then return jsonb_build_object('ok', false, 'error', 'La clase está llena'); end if;
      end if;
      if a.id is null then
        insert into gim_asistencias (empresa_id, cita_id, cliente_id, fecha, estado, profesor_id)
        values (r.o_empresa, p_cita, r.o_cliente, v_hoy, 'pendiente', ci.responsable_id) returning * into a;
      else
        update gim_asistencias set estado = 'pendiente', updated_at = now() where id = a.id returning * into a;
      end if;
    elsif a.estado = 'culminada' then
      return jsonb_build_object('ok', false, 'error', 'Ya marcaste tu llegada a esta clase');
    elsif a.estado = 'no_asistio' then
      return jsonb_build_object('ok', false, 'error', 'Esta clase ya está cerrada: pasá por recepción');
    end if;
  end if;

  a := gim_asistencia_mover(r.o_empresa, null, a.id, 'culminada', false, null, false);
  return jsonb_build_object('ok', true, 'marcada', jsonb_build_object('clase', coalesce(ci.titulo, 'Entrada libre'), 'hora', now(),
    'cubierta', a.suscripcion_id is not null, 'valor', a.valor),
    'alumno', gim_publico_alumno_json(r.o_empresa, r.o_cliente));
end;
$fn$;

-- ── Permisos de ejecución ────────────────────────────────────────────────────────────────────
do $do$
declare
  f text;
begin
  foreach f in array array['gim_asistencia_mover(uuid,uuid,uuid,text,boolean,text,boolean)', 'gim_publico_alumno(text,text,text)',
                           'gim_publico_alumno_json(uuid,uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['gim_asistencia_estado(uuid,text,boolean,text)', 'gim_autoasistencia_link(boolean)', 'gim_alumno_pin_crear(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['gim_publico_info(text)', 'gim_publico_entrar(text,text,text)', 'gim_publico_marcar(text,text,text,uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
