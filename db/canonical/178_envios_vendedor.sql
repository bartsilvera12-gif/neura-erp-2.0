-- =============================================================================
-- ENVÍOS — nombre del vendedor que cargó el envío. Receta 178, va después de 170/176/177.
-- IDEMPOTENTE. create or replace preserva grants.
--   · envios.creado_por_nombre: snapshot del usuario que creó el envío (sobrevive a bajas/renombres).
-- =============================================================================
\set ON_ERROR_STOP on
begin;
set search_path to :"schema", public;

alter table :"schema".envios add column if not exists creado_por_nombre text;

-- Backfill: el nombre del usuario que lo creó.
update :"schema".envios v
   set creado_por_nombre = u.nombre
  from :"schema".usuarios u
 where u.id = v.creado_por and v.creado_por_nombre is null;

-- ── envio_crear: guarda el nombre del vendedor que lo carga ──
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
  v_prods jsonb;
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
  select count(*), coalesce(jsonb_agg(jsonb_build_object('nombre', producto_nombre, 'cantidad', cantidad) order by producto_nombre), '[]'::jsonb)
    into v_items, v_prods from ventas_items where venta_id = vta.id;

  insert into envios (empresa_id, venta_id, cliente_id, cliente_nombre, numero, direccion, referencia, telefono,
                      estado_id, chofer_id, total, cobro_estado, items, productos, creado_por, creado_por_nombre)
    values (s.s_empresa, vta.id, vta.cliente_id, coalesce(cli.nombre, 'Consumidor final'), vta.numero_control,
            coalesce(nullif(btrim(coalesce(p->>'direccion', '')), ''), cli.direccion),
            nullif(btrim(coalesce(p->>'referencia', '')), ''),
            coalesce(nullif(btrim(coalesce(p->>'telefono', '')), ''), cli.telefono),
            v_estado, v_chofer, coalesce(vta.total, 0), v_cobro, coalesce(v_items, 0), coalesce(v_prods, '[]'::jsonb), s.s_usuario, s.s_nombre)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'cobro_estado', v_cobro);
end;
$fn$;

-- ── envios_tablero: expone el vendedor ──
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
        'total', v.total, 'cobro_estado', v.cobro_estado, 'notas', v.notas, 'items', v.items, 'productos', v.productos,
        'hora_estimada', to_char(v.hora_estimada, 'HH24:MI'), 'vendedor', v.creado_por_nombre,
        'creado_at', v.creado_at, 'entregado_at', v.entregado_at)
        order by v.creado_at)
      from envios v join envios_estados e on e.id = v.estado_id
     where v.empresa_id = s.s_empresa
       and (not e.es_final or v.entregado_at >= now() - interval '24 hours')), '[]'::jsonb));
end;
$fn$;

commit;

notify pgrst, 'reload schema';
