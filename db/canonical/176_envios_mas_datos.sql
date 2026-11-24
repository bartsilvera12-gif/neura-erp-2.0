-- =============================================================================
-- ENVÍOS — más datos en la tarjeta: cantidad de productos y hora estimada de entrega.
-- Receta 176, va después de 170/173. IDEMPOTENTE. create or replace preserva grants.
--   · envios.items: cantidad de productos de la venta (snapshot al crear el envío).
--   · envios.hora_estimada: hora estimada de entrega (la carga el operador; editable).
-- =============================================================================
\set ON_ERROR_STOP on
begin;
set search_path to :"schema", public;

alter table :"schema".envios add column if not exists items integer not null default 0;
alter table :"schema".envios add column if not exists hora_estimada time;

-- Backfill de los envíos ya existentes (cantidad de productos de su venta).
update :"schema".envios v
   set items = coalesce((select count(*) from ventas_items i where i.venta_id = v.venta_id), 0)
 where v.venta_id is not null and v.items = 0;

-- ── envio_crear: guarda la cantidad de productos de la venta ──
create or replace function :"schema".envio_crear(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_venta uuid := nullif(p->>'venta_id', '')::uuid;
  v_chofer uuid := nullif(p->>'chofer_id', '')::uuid;
  vta record;
  cli record;
  v_estado uuid;
  v_id uuid;
  v_cobro text;
  v_items integer;
begin
  select * into s from envios_sesion('envios_operar');
  perform envios_estados_seed(s.s_empresa);
  if v_venta is null then raise exception 'Falta la venta del envío'; end if;
  select id, cliente_id, numero_control, total, tipo_venta into vta
    from ventas where id = v_venta and empresa_id = s.s_empresa;
  if not found then raise exception 'Venta no encontrada'; end if;
  select id into v_id from envios where venta_id = v_venta;
  if found then return jsonb_build_object('id', v_id, 'reusado', true); end if;

  select id into v_estado from envios_estados
   where empresa_id = s.s_empresa and es_inicial and activo order by orden limit 1;
  if v_estado is null then raise exception 'No hay un estado inicial configurado'; end if;
  if v_chofer is not null and not exists (select 1 from envios_choferes where id = v_chofer and empresa_id = s.s_empresa) then
    raise exception 'Chofer no encontrado';
  end if;

  select nombre, direccion, telefono into cli from clientes where id = vta.cliente_id and empresa_id = s.s_empresa;
  v_cobro := case when vta.tipo_venta = 'CREDITO' and vta.cliente_id is not null then 'pendiente' else 'na' end;
  select count(*) into v_items from ventas_items where venta_id = vta.id;

  insert into envios (empresa_id, venta_id, cliente_id, cliente_nombre, numero, direccion, referencia, telefono,
                      estado_id, chofer_id, total, cobro_estado, items, creado_por)
    values (s.s_empresa, vta.id, vta.cliente_id, coalesce(cli.nombre, 'Consumidor final'), vta.numero_control,
            coalesce(nullif(btrim(coalesce(p->>'direccion', '')), ''), cli.direccion),
            nullif(btrim(coalesce(p->>'referencia', '')), ''),
            coalesce(nullif(btrim(coalesce(p->>'telefono', '')), ''), cli.telefono),
            v_estado, v_chofer, coalesce(vta.total, 0), v_cobro, coalesce(v_items, 0), s.s_usuario)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'cobro_estado', v_cobro);
end;
$fn$;

-- ── envio_editar: + hora estimada de entrega ──
create or replace function :"schema".envio_editar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
begin
  select * into s from envios_sesion('envios_operar');
  if v_id is null then raise exception 'Falta el envío'; end if;
  update envios set
      direccion = nullif(btrim(coalesce(p->>'direccion', '')), ''),
      referencia = nullif(btrim(coalesce(p->>'referencia', '')), ''),
      telefono = nullif(btrim(coalesce(p->>'telefono', '')), ''),
      hora_estimada = nullif(btrim(coalesce(p->>'hora_estimada', '')), '')::time,
      notas = left(nullif(btrim(coalesce(p->>'notas', '')), ''), 500),
      updated_at = now()
   where id = v_id and empresa_id = s.s_empresa;
  if not found then raise exception 'Envío no encontrado'; end if;
  return jsonb_build_object('id', v_id);
end;
$fn$;

-- ── envios_tablero: expone items y hora_estimada ──
create or replace function :"schema".envios_tablero()
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from envios_sesion('envios_operar');
  perform envios_estados_seed(s.s_empresa);
  return jsonb_build_object(
    'estados', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'nombre', e.nombre, 'color', e.color, 'orden', e.orden, 'es_inicial', e.es_inicial, 'es_final', e.es_final)
        order by e.orden, e.nombre)
      from envios_estados e where e.empresa_id = s.s_empresa and e.activo), '[]'::jsonb),
    'choferes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'telefono', c.telefono)
        order by c.nombre)
      from envios_choferes c where c.empresa_id = s.s_empresa and c.activo), '[]'::jsonb),
    'envios', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'numero', v.numero, 'cliente_nombre', v.cliente_nombre, 'direccion', v.direccion,
        'referencia', v.referencia, 'telefono', v.telefono, 'estado_id', v.estado_id, 'chofer_id', v.chofer_id,
        'total', v.total, 'cobro_estado', v.cobro_estado, 'notas', v.notas, 'items', v.items,
        'hora_estimada', to_char(v.hora_estimada, 'HH24:MI'),
        'creado_at', v.creado_at, 'entregado_at', v.entregado_at)
        order by v.creado_at)
      from envios v join envios_estados e on e.id = v.estado_id
     where v.empresa_id = s.s_empresa
       and (not e.es_final or v.entregado_at >= now() - interval '24 hours')), '[]'::jsonb));
end;
$fn$;

commit;

notify pgrst, 'reload schema';
