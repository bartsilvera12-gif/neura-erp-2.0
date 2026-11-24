-- =============================================================================
-- ENVÍOS — PAGO CONTRA ENTREGA (Fase 2). Receta 173, va después de 170.
--
-- Pago contra entrega = una venta a domicilio hecha a CRÉDITO: queda su cuenta por cobrar
-- pendiente y el envío nace con cobro_estado = 'pendiente'. Al entregar, desde la tarjeta del
-- tablero se cobra con `registrar_cobro` (entra a la caja abierta del usuario) y el envío pasa a
-- 'cobrado'. Una venta a domicilio al contado (ya cobrada en caja) nace 'na' (nada que cobrar).
--
--   · envio_crear: cobro_estado sale del tipo de venta (CREDITO → pendiente, si no → na).
--   · envio_cobrar(id, metodo, …): cobra el saldo de la venta de ese envío y lo marca cobrado.
-- IDEMPOTENTE. create or replace preserva grants.
-- =============================================================================
\set ON_ERROR_STOP on
begin;
set search_path to :"schema", public;

-- ── envio_crear: el cobro_estado sale del tipo de venta ──
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
  -- CREDITO con cliente → se cobra al entregar; si no, ya se cobró en caja.
  v_cobro := case when vta.tipo_venta = 'CREDITO' and vta.cliente_id is not null then 'pendiente' else 'na' end;

  insert into envios (empresa_id, venta_id, cliente_id, cliente_nombre, numero, direccion, referencia, telefono,
                      estado_id, chofer_id, total, cobro_estado, creado_por)
    values (s.s_empresa, vta.id, vta.cliente_id, coalesce(cli.nombre, 'Consumidor final'), vta.numero_control,
            coalesce(nullif(btrim(coalesce(p->>'direccion', '')), ''), cli.direccion),
            nullif(btrim(coalesce(p->>'referencia', '')), ''),
            coalesce(nullif(btrim(coalesce(p->>'telefono', '')), ''), cli.telefono),
            v_estado, v_chofer, coalesce(vta.total, 0), v_cobro, s.s_usuario)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'cobro_estado', v_cobro);
end;
$fn$;

-- ── envio_cobrar: cobra el saldo de la venta de ese envío (pago contra entrega) ──
-- Entra a la caja abierta del usuario (o p_caja_id). Aplica SOLO a la(s) cuenta(s) de esa venta.
create or replace function :"schema".envio_cobrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_metodo text := lower(nullif(btrim(coalesce(p->>'metodo', '')), ''));
  v_ref text := nullif(btrim(coalesce(p->>'referencia', '')), '');
  env record;
  v_aplic jsonb;
  v_saldo numeric;
  v_res jsonb;
begin
  select * into s from envios_sesion('envios_operar');
  perform exigir_permiso('registrar_cobros');
  if v_id is null then raise exception 'Falta el envío'; end if;
  if v_metodo is null or v_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'pos', 'cheque', 'otro') then
    raise exception 'Elegí cómo se cobró (efectivo, transferencia…)';
  end if;

  select * into env from envios where id = v_id and empresa_id = s.s_empresa;
  if not found then raise exception 'Envío no encontrado'; end if;
  if env.cobro_estado = 'cobrado' then raise exception 'Este envío ya está cobrado'; end if;
  if env.cobro_estado <> 'pendiente' then raise exception 'Este envío se cobró en la caja; no queda nada por cobrar'; end if;
  if env.venta_id is null or env.cliente_id is null then raise exception 'El envío no tiene una venta a crédito para cobrar'; end if;

  -- Cuentas por cobrar pendientes de ESTA venta (se cobra el saldo completo contra entrega).
  select jsonb_agg(jsonb_build_object('cxc_id', c.id, 'monto', c.saldo)), coalesce(sum(c.saldo), 0)
    into v_aplic, v_saldo
    from cuentas_por_cobrar c
   where c.venta_id = env.venta_id and c.estado in ('pendiente', 'parcial');

  if coalesce(v_saldo, 0) <= 0 then
    update envios set cobro_estado = 'cobrado', updated_at = now() where id = v_id;
    return jsonb_build_object('id', v_id, 'ya_estaba', true);
  end if;

  v_res := registrar_cobro(jsonb_build_object(
    'cliente_id', env.cliente_id,
    'caja_id', nullif(p->>'caja_id', '')::uuid,
    'pagos', jsonb_build_array(jsonb_build_object('metodo', v_metodo, 'monto', v_saldo, 'referencia', v_ref)),
    'aplicaciones', v_aplic,
    'observacion', left('Cobro contra entrega · envío ' || coalesce(env.numero, ''), 1000)));

  update envios set cobro_estado = 'cobrado', updated_at = now() where id = v_id;
  return jsonb_build_object('id', v_id, 'cobrado', v_saldo, 'cobro', v_res);
end;
$fn$;

-- Seguridad (receta 112): la nueva función con sesión.
do $do$
begin
  execute 'revoke all on function envio_cobrar(jsonb) from public, anon';
  execute 'grant execute on function envio_cobrar(jsonb) to authenticated, service_role';
end;
$do$;

commit;

notify pgrst, 'reload schema';
