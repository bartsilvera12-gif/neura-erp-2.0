-- =============================================================================
-- PRUEBAS DE PLATA Y STOCK. Corren con `npm run test:db`.
--
-- Todo va en UNA transacción que termina en ROLLBACK (99_fin.sql): no queda ningún dato. Cada resultado
-- sale como aviso `PRUEBA|OK|...` o `PRUEBA|FALLA|...`, porque los avisos sobreviven al rollback.
-- Cada escenario arma sus propios productos y usa una sucursal, un depósito y una caja de prueba.
-- =============================================================================

begin;
set local search_path to :"schema", public;
set local client_min_messages to notice;

-- ── Comprobaciones ───────────────────────────────────────────────────────────
create function pg_temp.ok(p_nombre text, p_cond boolean, p_detalle text default '') returns void language plpgsql as $$
begin
  raise notice 'PRUEBA|%|%|%', case when coalesce(p_cond, false) then 'OK' else 'FALLA' end, p_nombre, p_detalle;
end $$;

create function pg_temp.igual(p_nombre text, p_real numeric, p_esperado numeric) returns void language plpgsql as $$
begin
  perform pg_temp.ok(p_nombre, p_real is not distinct from p_esperado, format('esperado %s, dio %s', p_esperado, p_real));
end $$;

-- El SQL tiene que ser rechazado con un mensaje que contenga p_contiene; lo que alcanzó a hacer se deshace.
create function pg_temp.rechaza(p_nombre text, p_sql text, p_contiene text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    perform pg_temp.ok(p_nombre, position(lower(p_contiene) in lower(sqlerrm)) > 0, sqlerrm);
    return;
  end;
  perform pg_temp.ok(p_nombre, false, 'se aceptó y tenía que rechazarse');
end $$;

-- ── Datos de prueba ──────────────────────────────────────────────────────────
create temp table prueba_fx (clave text primary key, id uuid);
grant select, insert on prueba_fx to public;

create function pg_temp.fx(p_clave text) returns uuid language sql as $$ select id from prueba_fx where clave = p_clave $$;

create function pg_temp.como(p_clave text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.fx(p_clave), 'role', 'authenticated')::text, true);
$$;

do $$
declare
  v_emp uuid;
  v_admin uuid;
  v_suc uuid;
  v_dep uuid;
  v_dep2 uuid;
  v_pv uuid;
  v_pv2 uuid;
  v_id uuid;
  v_auth uuid := gen_random_uuid();
begin
  select u.empresa_id, u.auth_user_id into v_emp, v_admin from usuarios u where u.rol = 'ADMIN' and u.activo order by u.creado_at limit 1;
  if v_admin is null then raise exception 'No hay un administrador activo para las pruebas'; end if;

  insert into sucursales (empresa_id, nombre, activa) values (v_emp, 'PRUEBA Sucursal', true) returning id into v_suc;
  insert into depositos (empresa_id, sucursal_id, nombre, activo) values (v_emp, v_suc, 'PRUEBA Depósito A', true) returning id into v_dep;
  insert into depositos (empresa_id, sucursal_id, nombre, activo) values (v_emp, v_suc, 'PRUEBA Depósito B', true) returning id into v_dep2;
  insert into puntos_venta (empresa_id, sucursal_id, deposito_id, nombre, activo) values (v_emp, v_suc, v_dep, 'PRUEBA Caja', true) returning id into v_pv;
  insert into puntos_venta (empresa_id, sucursal_id, deposito_id, nombre, activo) values (v_emp, v_suc, v_dep, 'PRUEBA Caja 2', true) returning id into v_pv2;

  insert into prueba_fx values ('empresa', v_emp), ('admin', v_admin), ('sucursal', v_suc), ('dep_a', v_dep), ('dep_b', v_dep2), ('pv', v_pv), ('pv2', v_pv2), ('cajero', v_auth);

  insert into clientes (empresa_id, nombre) values (v_emp, 'PRUEBA Cliente') returning id into v_id;
  insert into prueba_fx values ('cliente', v_id);
  insert into clientes (empresa_id, nombre, limite_credito) values (v_emp, 'PRUEBA Cliente con límite', 50000) returning id into v_id;
  insert into prueba_fx values ('cliente_limite', v_id);
  insert into proveedores (empresa_id, nombre) values (v_emp, 'PRUEBA Proveedor') returning id into v_id;
  insert into prueba_fx values ('proveedor', v_id);

  -- Usuario Cajero de mentira (sin cuenta real): solo existe dentro de esta transacción.
  insert into usuarios (empresa_id, auth_user_id, nombre, email, rol, perfil_id, activo)
    values (v_emp, v_auth, 'PRUEBA Cajero', 'prueba-cajero@example.invalid', 'CAJERO', perfil_de_rol(v_emp, 'CAJERO'), true);
  update usuarios set sucursal_id = v_suc where auth_user_id = v_auth;
end $$;

-- Las capas no las lee un usuario, pero las pruebas sí las miran.
create function pg_temp.capas(p_producto uuid) returns table (id uuid, quedan numeric) language sql security definer as $$
  select c.id, c.quedan from capas_costo c where c.producto_id = p_producto order by c.seq;
$$;

-- Deja al perfil Cajero con o sin el permiso de descuentos y con un tope, para probar ambos casos.
create function pg_temp.cajero_descuentos(p_permite boolean, p_tope numeric) returns void language plpgsql security definer as $$
declare
  v_perfil uuid := perfil_de_rol(pg_temp.fx('empresa'), 'CAJERO');
begin
  update perfiles set tope_descuento_pct = p_tope where id = v_perfil;
  delete from perfil_permisos where perfil_id = v_perfil and permiso = 'descuentos_precio';
  if p_permite then insert into perfil_permisos (empresa_id, perfil_id, permiso) values (pg_temp.fx('empresa'), v_perfil, 'descuentos_precio'); end if;
end $$;

set local role authenticated;
select pg_temp.como('admin');

-- ── Atajos ───────────────────────────────────────────────────────────────────
create function pg_temp.producto(p_nombre text, p_precio numeric, p_iva text default '10%') returns uuid language sql as $$
  insert into productos (empresa_id, nombre, sku, precio_venta, tipo_iva, controla_stock, activo)
  values (pg_temp.fx('empresa'), 'PRUEBA ' || p_nombre, 'PRUEBA-' || gen_random_uuid(), p_precio, p_iva, true, true)
  returning id;
$$;

create function pg_temp.stock(p_producto uuid, p_deposito text default 'dep_a') returns numeric language sql as $$
  select coalesce((select cantidad from stock_depositos where producto_id = p_producto and deposito_id = pg_temp.fx(p_deposito)), 0);
$$;

create function pg_temp.comprar(p_producto uuid, p_cant numeric, p_costo numeric, p_extra jsonb default '{}') returns jsonb language sql as $$
  select registrar_compra(jsonb_build_object(
    'con_comprobante', false, 'tipo_pago', 'contado', 'medio_pago', 'transferencia', 'sucursal_id', pg_temp.fx('sucursal'), 'deposito_id', pg_temp.fx('dep_a'),
    'items', jsonb_build_array(jsonb_build_object('producto_id', p_producto, 'cantidad', p_cant, 'costo_unitario', p_costo))) || p_extra);
$$;

create function pg_temp.vender(p_producto uuid, p_cant numeric, p_pagos jsonb default null, p_clave text default null, p_descuento numeric default 0) returns jsonb language sql as $$
  select crear_venta(null, 'CONTADO', 'efectivo', 'GS', null,
    jsonb_build_array(jsonb_build_object('producto_id', p_producto, 'cantidad', p_cant)), p_pagos, p_clave,
    p_descuento_pct => p_descuento, p_caja_id => pg_temp.fx('caja'));
$$;

create function pg_temp.vender_a(p_cliente uuid, p_producto uuid, p_cant numeric, p_tipo text default 'CONTADO', p_pagos jsonb default null, p_cuotas integer default 1) returns jsonb language sql as $$
  select crear_venta(p_cliente, p_tipo, 'efectivo', 'GS', null,
    jsonb_build_array(jsonb_build_object('producto_id', p_producto, 'cantidad', p_cant)), p_pagos, null,
    p_plazo_dias => case when p_tipo = 'CREDITO' then 30 end, p_caja_id => pg_temp.fx('caja'), p_cuotas => p_cuotas);
$$;

create function pg_temp.efectivo() returns numeric language sql as $$ select caja_efectivo_esperado(pg_temp.fx('caja')) $$;

do $$
begin
  insert into prueba_fx values ('caja', (abrir_caja(pg_temp.fx('pv'), 1000000)->>'caja_id')::uuid);
end $$;
