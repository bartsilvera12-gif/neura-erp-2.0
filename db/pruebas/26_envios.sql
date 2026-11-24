-- =============================================================================
-- ENVÍOS — pago contra entrega (recetas 170 + 173). Una venta a crédito a domicilio nace
-- pendiente de cobro; al entregar se cobra y entra a la caja. No se cobra dos veces.
-- =============================================================================

-- La función Envíos se prende para la empresa (dentro de la transacción de prueba, se revierte).
-- Los helpers de lectura se crean como postgres (dueño) para poder mirar las tablas cerradas.
reset role;
update empresa_funciones set envios = true;
create function pg_temp.env_cobro(p_id uuid) returns text language sql security definer as $$ select cobro_estado from envios where id = p_id $$;
create function pg_temp.cxc_pend(p_venta uuid) returns boolean language sql security definer as $$ select exists (select 1 from cuentas_por_cobrar where venta_id = p_venta and estado in ('pendiente', 'parcial')) $$;
grant execute on function pg_temp.env_cobro(uuid), pg_temp.cxc_pend(uuid) to public;
set local role authenticated;
select pg_temp.como('admin');

do $$
declare v_prod uuid; v_venta jsonb; v_env uuid;
begin
  v_prod := pg_temp.producto('Delivery combo', 50000);
  perform pg_temp.comprar(v_prod, 10, 20000);                 -- stock
  v_venta := pg_temp.vender_a(pg_temp.fx('cliente'), v_prod, 1, 'CREDITO');  -- venta a crédito (a domicilio)
  insert into prueba_fx values ('venta_env', (v_venta->>'venta_id')::uuid);
  v_env := (envio_crear(jsonb_build_object('venta_id', (v_venta->>'venta_id')::uuid, 'direccion', 'Av. Siempre Viva 742'))->>'id')::uuid;
  insert into prueba_fx values ('envio', v_env);
end $$;

-- 1) el envío de una venta a crédito nace "pendiente de cobro".
select pg_temp.ok('envío a crédito nace pendiente', pg_temp.env_cobro(pg_temp.fx('envio')) = 'pendiente');
-- 2) la venta a crédito generó su cuenta por cobrar (no entró a la caja aún).
select pg_temp.ok('la venta a crédito tiene cuenta por cobrar', pg_temp.cxc_pend(pg_temp.fx('venta_env')));

-- Guardamos el efectivo de la caja antes de cobrar (otras pruebas ya movieron la caja).
select set_config('prueba.efectivo_antes', pg_temp.efectivo()::text, true);

-- 3) cobrar contra entrega (efectivo) en la caja de prueba: entra a la caja y el envío queda cobrado.
do $$ begin perform envio_cobrar(jsonb_build_object('id', pg_temp.fx('envio'), 'metodo', 'efectivo', 'caja_id', pg_temp.fx('caja'))); end $$;
select pg_temp.ok('el envío queda cobrado', pg_temp.env_cobro(pg_temp.fx('envio')) = 'cobrado');
select pg_temp.igual('el cobro de 50.000 entró a la caja', pg_temp.efectivo(), current_setting('prueba.efectivo_antes')::numeric + 50000);
select pg_temp.ok('la cuenta por cobrar quedó pagada', not pg_temp.cxc_pend(pg_temp.fx('venta_env')));

-- 4) no se cobra dos veces el mismo envío.
select pg_temp.rechaza('no se cobra dos veces',
  $q$ select envio_cobrar(jsonb_build_object('id', pg_temp.fx('envio'), 'metodo', 'efectivo')) $q$, 'ya está cobrado');

-- 5) un envío de una venta al contado no tiene nada que cobrar (nace 'na').
do $$
declare v_prod uuid; v_venta jsonb; v_env uuid;
begin
  v_prod := pg_temp.producto('Delivery contado', 30000);
  perform pg_temp.comprar(v_prod, 5, 10000);
  v_venta := pg_temp.vender(v_prod, 1);                        -- contado (ya cobrado en caja)
  v_env := (envio_crear(jsonb_build_object('venta_id', (v_venta->>'venta_id')::uuid))->>'id')::uuid;
  insert into prueba_fx values ('envio_contado', v_env);
end $$;
select pg_temp.ok('envío al contado nace sin cobro pendiente', pg_temp.env_cobro(pg_temp.fx('envio_contado')) = 'na');
select pg_temp.rechaza('un envío al contado no se cobra de nuevo',
  $q$ select envio_cobrar(jsonb_build_object('id', pg_temp.fx('envio_contado'), 'metodo', 'efectivo')) $q$, 'se cobró en la caja');
