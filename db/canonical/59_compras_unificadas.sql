-- =============================================================================
-- COMPRAS UNIFICADAS: compras de mercadería y gastos en UN solo documento, con el tipo
-- elegido POR LÍNEA (amplía 22/49/50/52/54/58).
--
-- Modelo:
--   · compras (cabecera de siempre: proveedor, comprobante, condición, moneda, número COMP-…)
--       + tipo              'mercaderia' | 'gasto' | 'mixta' (lo calcula registrar_compra según
--                           las líneas; sirve para filtrar)
--       + sucursal_id       centro de costo (por defecto la del depósito o la del usuario)
--       + con_comprobante   false = sin comprobante fiscal (sueldo, propina, peaje…): proveedor
--                           opcional (si es al contado), sin número de factura, no deducible
--       + tipo_comprobante  Factura, Recibo, Boleta… (la lista de Gastos)
--       + cuenta_bancaria_id cuenta propia de donde salió una transferencia/cheque/tarjeta
--       + total_mercaderia / total_gastos (Gs.), exenta / total_5 / iva_5 / total_10 / iva_10
--         e iva_credito (IVA deducible) — totales e IVA por tasa sobre TODAS las líneas.
--     proveedor_id, proveedor_nombre y numero_factura pasan a opcionales (con chequeos).
--   · compras_items      las líneas de MERCADERÍA (sin cambios: stock, costo, lotes, kardex).
--   · compras_gastos     NUEVA: las líneas de GASTO (subcategoría de gasto, descripción, monto
--                        IVA incluido en la moneda de la compra y en Gs., IVA, deducible,
--                        sucursal, empleado en las de personal). No tocan stock.
--   · gastos / gasto_items (receta 48/52) QUEDAN como están: lo ya cargado no se migra y los
--     recurrentes siguen generando sus borradores ahí. La lista unificada los muestra junto con
--     las compras (listar_compras_gastos).
--
-- Funciones:
--   REDEFINE: registrar_compra (mercadería y/o gastos; proveedor opcional sin comprobante),
--     anular_compra (revierte stock SOLO de la mercadería; permisos por tipo de línea),
--     tg_compras_cxp (deuda en USD incluye los gastos), gastos_resumen, presupuesto_gastos,
--     gastos_catalogos (usos y "lo último por proveedor" incluyen las compras), reporte_estado_cuenta,
--     reporte_proveedores, reporte_proveedor, reporte_cxp (54): la mercadería cuenta como compra
--     de mercadería y las líneas de gasto como gasto operativo (por categoría y sucursal), sin
--     contar doble. De paso: compras.total y compras_items.costo_unitario YA están en Gs.; los
--     reportes no los vuelven a multiplicar por el tipo de cambio.
--   NUEVA: listar_compras_gastos (lista unificada con búsqueda precisa: documento exacto,
--     N° de factura, monto, RUC; filtros por tipo, estado, fechas, sucursal, proveedor,
--     categoría, fijo/variable, IVA deducible y origen).
-- Permisos: los existentes. Alta de compra: 'registrar_compras' si tiene mercadería y
--   'registrar_gastos' si tiene gastos; anulación igual con 'anular_compras' / 'anular_gastos'.
-- Seguridad: compras, compras_items y compras_gastos son de SOLO LECTURA para la sesión; se
--   escriben solo con las funciones SECURITY DEFINER (validan empresa, rol y permiso adentro).
-- IDEMPOTENTE. Va después de 58.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Tablas
-- =============================================================================
alter table :"schema".compras alter column proveedor_id drop not null;
alter table :"schema".compras alter column proveedor_nombre drop not null;
alter table :"schema".compras alter column numero_factura drop not null;
alter table :"schema".compras add column if not exists tipo text not null default 'mercaderia';
alter table :"schema".compras add column if not exists sucursal_id uuid references :"schema".sucursales(id);
alter table :"schema".compras add column if not exists con_comprobante boolean not null default true;
alter table :"schema".compras add column if not exists tipo_comprobante text;
alter table :"schema".compras add column if not exists cuenta_bancaria_id uuid references :"schema".cuentas_bancarias(id);
alter table :"schema".compras add column if not exists total_mercaderia numeric not null default 0;
alter table :"schema".compras add column if not exists total_gastos numeric not null default 0;
alter table :"schema".compras add column if not exists exenta numeric not null default 0;
alter table :"schema".compras add column if not exists total_5 numeric not null default 0;
alter table :"schema".compras add column if not exists iva_5 numeric not null default 0;
alter table :"schema".compras add column if not exists total_10 numeric not null default 0;
alter table :"schema".compras add column if not exists iva_10 numeric not null default 0;
alter table :"schema".compras add column if not exists iva_credito numeric not null default 0;

alter table :"schema".compras drop constraint if exists chk_compra_tipo;
alter table :"schema".compras add constraint chk_compra_tipo check (tipo in ('mercaderia', 'gasto', 'mixta'));
-- Sin proveedor solo sin comprobante fiscal y al contado (a crédito se le debe a alguien).
alter table :"schema".compras drop constraint if exists chk_compra_proveedor;
alter table :"schema".compras add constraint chk_compra_proveedor
  check (proveedor_id is not null or (not con_comprobante and tipo_pago = 'contado'));
alter table :"schema".compras drop constraint if exists chk_compra_factura;
alter table :"schema".compras add constraint chk_compra_factura check (numero_factura is not null or not con_comprobante);

create index if not exists compras_tipo_idx on :"schema".compras (empresa_id, tipo);
create index if not exists compras_sucursal_idx on :"schema".compras (empresa_id, sucursal_id);
create index if not exists compras_fecha_factura_idx on :"schema".compras
  (empresa_id, coalesce(fecha_factura, (fecha at time zone 'America/Asuncion')::date) desc);

-- Compras existentes: todas son de mercadería (sucursal = la del depósito, IVA por tasa de sus ítems).
update :"schema".compras c set sucursal_id = d.sucursal_id
  from :"schema".depositos d where d.id = c.deposito_id and c.sucursal_id is null;
update :"schema".compras set tipo_comprobante = 'Factura' where tipo_comprobante is null and con_comprobante;
update :"schema".compras set total_mercaderia = total
 where tipo = 'mercaderia' and total_mercaderia = 0 and total <> 0;
update :"schema".compras c set
  exenta = x.ex, total_5 = x.t5, iva_5 = x.i5, total_10 = x.t10, iva_10 = x.i10,
  iva_credito = case when c.con_comprobante then x.i5 + x.i10 else 0 end
  from (select i.compra_id,
               coalesce(sum(i.total) filter (where i.tipo_iva not in ('10%', '5%')), 0) as ex,
               coalesce(sum(i.total) filter (where i.tipo_iva = '5%'), 0) as t5,
               coalesce(sum(i.monto_iva) filter (where i.tipo_iva = '5%'), 0) as i5,
               coalesce(sum(i.total) filter (where i.tipo_iva = '10%'), 0) as t10,
               coalesce(sum(i.monto_iva) filter (where i.tipo_iva = '10%'), 0) as i10
          from :"schema".compras_items i group by i.compra_id) x
 where x.compra_id = c.id and c.tipo = 'mercaderia' and c.exenta = 0 and c.total_5 = 0 and c.total_10 = 0;

-- ── Líneas de GASTO de una compra ───────────────────────────────────────────
create table if not exists :"schema".compras_gastos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  compra_id uuid not null references :"schema".compras(id) on delete cascade,
  orden integer not null default 0,
  categoria_id uuid references :"schema".gasto_categorias(id) on delete set null,
  categoria_nombre text,                           -- foto del nombre
  descripcion text not null,
  monto_original numeric not null,                 -- IVA incluido, en la moneda de la compra
  monto numeric not null,                          -- IVA incluido, en Gs.
  iva_tipo text not null default '10%',
  monto_iva numeric not null default 0,            -- Gs.
  deducible boolean not null default true,
  sucursal_id uuid references :"schema".sucursales(id),
  empleado_id uuid references :"schema".empleados(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint chk_compras_gastos_monto check (monto_original > 0 and monto > 0),
  constraint chk_compras_gastos_iva check (iva_tipo in ('10%', '5%', 'exenta')),
  constraint chk_compras_gastos_desc check (btrim(descripcion) <> '')
);
create index if not exists compras_gastos_compra_idx on :"schema".compras_gastos (compra_id, orden);
create index if not exists compras_gastos_categoria_idx on :"schema".compras_gastos (categoria_id);
create index if not exists compras_gastos_sucursal_idx on :"schema".compras_gastos (empresa_id, sucursal_id);

-- Seguridad: solo lectura para la sesión (se escriben con registrar_compra / anular_compra).
do $sec$
declare t text;
begin
  foreach t in array array['compras', 'compras_items', 'compras_gastos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_propias', t);
    execute format('drop policy if exists %I on %I', t || '_propios', t);
    execute format('drop policy if exists %I on %I', t || '_lectura', t);
    execute format('create policy %I on %I for select to authenticated using (empresa_id = empresa_actual())', t || '_lectura', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end
$sec$;

-- Permiso del perfil en la base: el alta y la anulación aceptan el de compras o el de gastos;
-- registrar_compra / anular_compra exigen el exacto según las líneas.
drop trigger if exists trg_compras_permiso_alta on :"schema".compras;
create trigger trg_compras_permiso_alta before insert on :"schema".compras
  for each row execute function :"schema".tg_exige_permiso('registrar_compras|registrar_gastos', '');
drop trigger if exists trg_compras_permiso_anular on :"schema".compras;
create trigger trg_compras_permiso_anular before update of anulada_at on :"schema".compras
  for each row execute function :"schema".tg_exige_permiso('anular_compras|anular_gastos', 'anulada_at');

-- =============================================================================
-- 2. registrar_compra — mercadería (items) y/o gastos (gastos) en un solo documento
-- =============================================================================
create or replace function :"schema".registrar_compra(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_empresa uuid;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_idem uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_rep record;
  v_prov_id uuid;
  v_prov_nombre text;
  v_dep record;
  v_dep_id uuid;
  v_dep_nombre text;
  v_dep_suc uuid;
  v_compra uuid;
  v_numero text;
  v_moneda text := coalesce(nullif(p->>'moneda', ''), 'GS');
  v_cambio numeric := case when coalesce(nullif(p->>'moneda', ''), 'GS') = 'USD' then nullif(p->>'tipo_cambio', '')::numeric else 1 end;
  v_dec integer;
  v_tipo_pago text := coalesce(nullif(p->>'tipo_pago', ''), 'contado');
  v_plazo integer := nullif(p->>'plazo_dias', '')::integer;
  v_venc date := nullif(p->>'vencimiento', '')::date;
  v_fecha_fact date := coalesce(nullif(p->>'fecha_factura', '')::date, (now() at time zone 'America/Asuncion')::date);
  v_con boolean := coalesce(nullif(p->>'con_comprobante', '')::boolean, true);
  v_tipo_comp text := left(nullif(btrim(coalesce(p->>'tipo_comprobante', '')), ''), 60);
  v_factura text := left(nullif(btrim(coalesce(p->>'numero_factura', '')), ''), 40);
  v_timbrado text := left(nullif(regexp_replace(coalesce(p->>'nro_timbrado', ''), '\s+', '', 'g'), ''), 20);
  v_medio text := nullif(btrim(coalesce(p->>'medio_pago', '')), '');
  v_ref text := left(nullif(btrim(coalesce(p->>'referencia_pago', '')), ''), 120);
  v_cuenta uuid := nullif(p->>'cuenta_bancaria_id', '')::uuid;
  v_suc_pedida uuid := nullif(p->>'sucursal_id', '')::uuid;
  v_suc uuid;
  v_excedente boolean := coalesce(nullif(p->>'permitir_excedente', '')::boolean, false);
  v_items jsonb := coalesce(p->'items', '[]'::jsonb);
  v_gastos jsonb := coalesce(p->'gastos', '[]'::jsonb);
  v_n_merc integer;
  v_n_gasto integer;
  v_tipo text;
  v_caja uuid;
  it jsonb;
  prod record;
  oci record;
  cat record;
  v_cant numeric;
  v_costo_orig numeric;
  v_costo numeric;
  v_total_linea numeric;
  v_iva_linea numeric;
  v_cpp numeric;
  v_pv numeric;
  v_t10 numeric := 0; v_i10 numeric := 0; v_t5 numeric := 0; v_i5 numeric := 0; v_ex numeric := 0;
  v_total numeric := 0;
  v_total_merc numeric := 0;
  v_total_gastos numeric := 0;
  v_credito_iva numeric := 0;
  v_orden integer := 0;
  v_gorden integer := 0;
  v_oc uuid := nullif(p->>'orden_compra_id', '')::uuid;
  v_oc_row record;
  v_oc_item uuid;
  v_item uuid;
  v_lote_num text;
  v_lote_venc date;
  v_lote uuid;
  v_cons text;
  v_monto_orig numeric;
  v_monto numeric;
  v_iva text;
  v_desc text;
  v_isuc uuid;
  v_emple uuid;
  v_ded boolean;
  v_hay_empleados boolean;
  v_concepto text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_empresa := s.s_empresa;

  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_typeof(v_gastos) is distinct from 'array' then
    raise exception 'Formato de líneas inválido';
  end if;
  v_n_merc := jsonb_array_length(v_items);
  v_n_gasto := jsonb_array_length(v_gastos);
  if v_n_merc + v_n_gasto = 0 then raise exception 'La compra no tiene líneas: cargá al menos un producto o un gasto'; end if;
  if v_n_merc + v_n_gasto > 300 then raise exception 'Máximo 300 líneas por compra'; end if;
  v_tipo := case when v_n_gasto = 0 then 'mercaderia' when v_n_merc = 0 then 'gasto' else 'mixta' end;
  -- Cada tipo de línea con su permiso del perfil.
  if v_n_merc > 0 then perform exigir_permiso('registrar_compras'); end if;
  if v_n_gasto > 0 then perform exigir_permiso('registrar_gastos'); end if;

  -- Idempotencia: el mismo envío (doble clic, reintento) espera al primero y lo devuelve.
  if v_idem is not null then
    perform pg_advisory_xact_lock(hashtextextended('compra:' || v_empresa::text || ':' || v_idem::text, 0));
    select id, numero_control, total, tipo into v_rep from compras where empresa_id = v_empresa and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('id', v_rep.id, 'numero_control', v_rep.numero_control, 'total', v_rep.total, 'tipo', v_rep.tipo, 'repetido', true);
    end if;
  end if;

  if v_tipo_pago not in ('contado', 'credito') then raise exception 'Condición de pago inválida'; end if;
  if v_moneda not in ('GS', 'USD') then raise exception 'Moneda inválida'; end if;
  if v_cambio is null or v_cambio <= 0 then raise exception 'Cargá la cotización del dólar'; end if;
  if v_cambio > 100000 then raise exception 'La cotización del dólar parece incorrecta'; end if;
  v_dec := case when v_moneda = 'USD' then 2 else 0 end;
  if v_plazo is not null and (v_plazo < 0 or v_plazo > 3650) then raise exception 'El plazo tiene que estar entre 0 y 3650 días'; end if;
  if v_fecha_fact > v_hoy then raise exception 'La fecha del comprobante no puede ser futura'; end if;

  if v_con then
    v_tipo_comp := coalesce(v_tipo_comp, 'Factura');
  else
    v_tipo_comp := null;
    v_timbrado := null;
  end if;

  if nullif(p->>'proveedor_id', '') is not null then
    select pr.id, coalesce(nullif(btrim(pr.nombre_comercial), ''), pr.nombre) into v_prov_id, v_prov_nombre
      from proveedores pr where pr.id = (p->>'proveedor_id')::uuid and pr.empresa_id = v_empresa;
    if v_prov_id is null then raise exception 'Proveedor no encontrado'; end if;
  end if;
  if v_prov_id is null then
    if v_con then raise exception 'Elegí el proveedor'; end if;
    if v_tipo_pago = 'credito' then raise exception 'A crédito elegí el proveedor (se le debe a alguien)'; end if;
    if v_oc is not null then raise exception 'Elegí el proveedor de la orden'; end if;
  end if;
  if v_con and v_factura is null then raise exception 'Falta el número de factura'; end if;

  if v_cuenta is not null then
    perform 1 from cuentas_bancarias where id = v_cuenta and empresa_id = v_empresa;
    if not found then raise exception 'Cuenta bancaria no encontrada'; end if;
  end if;
  if v_suc_pedida is not null then
    perform 1 from sucursales where id = v_suc_pedida and empresa_id = v_empresa;
    if not found then raise exception 'Sucursal no encontrada'; end if;
  end if;

  -- Depósito al que entra la mercadería (solo si hay mercadería): el elegido, o el principal
  -- de la sucursal de la compra / del usuario.
  if v_n_merc > 0 then
    v_dep_id := coalesce(nullif(p->>'deposito_id', '')::uuid, deposito_por_defecto(v_empresa, coalesce(v_suc_pedida, s.s_sucursal)));
    select * into v_dep from inv_deposito(v_empresa, v_dep_id, true);
    v_dep_id := v_dep.dep_id;
    v_dep_nombre := v_dep.dep_nombre;
    v_dep_suc := v_dep.suc_id;
  end if;
  -- Centro de costo: la sucursal elegida; si no, la del depósito o la del usuario.
  v_suc := coalesce(v_suc_pedida, v_dep_suc, gasto_sucursal_defecto(v_empresa, s.s_sucursal));

  -- Contado: cómo se pagó. El efectivo sale de la caja abierta (solo Gs.).
  if v_tipo_pago = 'contado' then
    if v_medio is not null and v_medio not in ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro') then
      raise exception 'Medio de pago inválido';
    end if;
    if v_medio = 'efectivo' then
      if v_moneda <> 'GS' then
        raise exception 'El efectivo de la caja es en guaraníes: una compra en dólares al contado va por transferencia, cheque u otro medio';
      end if;
      v_caja := caja_abierta_para(null, v_suc_pedida, nullif(p->>'caja_id', '')::uuid);
      if v_caja is null then raise exception 'Para pagar en efectivo abrí la caja primero (el efectivo sale de la caja)'; end if;
      v_ref := null;
    end if;
    if v_medio is null or v_medio not in ('transferencia', 'cheque', 'tarjeta') then v_cuenta := null; end if;
  else
    v_medio := null;
    v_ref := null;
    v_cuenta := null;
    if v_venc is not null and v_venc < v_fecha_fact then raise exception 'El vencimiento no puede ser anterior a la fecha del comprobante'; end if;
  end if;

  -- Recepción de una orden de compra: del mismo proveedor, ni cancelada ni ya recibida completa.
  if v_oc is not null then
    select id, numero_oc, estado into v_oc_row from ordenes_compra
     where id = v_oc and empresa_id = v_empresa and proveedor_id = v_prov_id for update;
    if not found then raise exception 'La orden de compra no es de este proveedor'; end if;
    if v_oc_row.estado = 'cancelada' then raise exception 'La orden % está cancelada: no se puede recibir', v_oc_row.numero_oc; end if;
    if v_oc_row.estado = 'recibida_total' then
      raise exception 'La orden % ya se recibió completa. Si llegó algo más, cargalo como una compra sin orden', v_oc_row.numero_oc;
    end if;
  end if;

  -- Misma factura del mismo proveedor ya cargada (no anulada).
  if v_prov_id is not null and v_factura is not null and exists (
       select 1 from compras c
        where c.empresa_id = v_empresa and c.proveedor_id = v_prov_id and c.estado <> 'anulada'
          and coalesce(c.nro_timbrado, '') = coalesce(v_timbrado, '')
          and regexp_replace(lower(c.numero_factura), '[^a-z0-9]+', '', 'g') = regexp_replace(lower(v_factura), '[^a-z0-9]+', '', 'g')) then
    raise exception 'La factura % de % ya está cargada', v_factura, v_prov_nombre;
  end if;

  v_numero := 'COMP-' || lpad(reservar_secuencia('compra', coalesce((
                select max(substring(numero_control from '[0-9]+$')::bigint) from compras where empresa_id = v_empresa), 0))::text, 6, '0');

  begin
    insert into compras (empresa_id, numero_control, proveedor_id, proveedor_nombre, fecha_factura, nro_timbrado,
                         numero_factura, tipo_pago, plazo_dias, vencimiento, moneda, tipo_cambio, observacion,
                         created_by, usuario_nombre, orden_compra_id, idempotency_key, medio_pago, referencia_pago, caja_id,
                         deposito_id, tipo, sucursal_id, con_comprobante, tipo_comprobante, cuenta_bancaria_id)
      values (v_empresa, v_numero, v_prov_id, v_prov_nombre, v_fecha_fact, v_timbrado, v_factura, v_tipo_pago,
              case when v_tipo_pago = 'credito' then v_plazo end,
              case when v_tipo_pago = 'credito' then coalesce(v_venc, case when v_plazo is not null then v_fecha_fact + v_plazo end) end,
              v_moneda, v_cambio, left(nullif(btrim(p->>'observacion'), ''), 2000), auth.uid(), s.s_nombre, v_oc,
              v_idem, v_medio, v_ref, v_caja, v_dep_id, v_tipo, v_suc, v_con, v_tipo_comp, v_cuenta)
      returning id into v_compra;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'uq_compras_factura' then
      raise exception 'La factura % de % ya está cargada', v_factura, v_prov_nombre;
    end if;
    raise;
  end;

  -- ── Mercadería: stock, costo promedio, precio, lotes y kardex (igual que siempre) ──
  for it in select * from jsonb_array_elements(v_items) loop
    v_orden := v_orden + 1;
    v_cant := nullif(it->>'cantidad', '')::numeric;
    v_costo_orig := nullif(it->>'costo_unitario', '')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Producto %: la cantidad tiene que ser mayor a 0', v_orden; end if;
    if v_costo_orig is null or v_costo_orig <= 0 then raise exception 'Producto %: falta el costo', v_orden; end if;
    v_costo := round(v_costo_orig * v_cambio, 2);

    select * into prod from productos where id = nullif(it->>'producto_id', '')::uuid and empresa_id = v_empresa for update;
    if not found then raise exception 'Producto % no encontrado', v_orden; end if;

    -- Lotes: solo productos que controlan stock y lotes. Vencimiento obligatorio.
    v_lote_num := null; v_lote_venc := null;
    if prod.controla_stock and prod.controla_lotes then
      v_lote_venc := nullif(it->>'vencimiento', '')::date;
      if v_lote_venc is null then
        raise exception 'Producto %: "%" controla lotes, cargá el vencimiento', v_orden, prod.nombre;
      end if;
      v_lote_num := upper(btrim(coalesce(nullif(btrim(it->>'lote'), ''), lote_numero_auto())));
    end if;

    v_total_linea := round(v_cant * v_costo);
    v_iva_linea := iva_contenido(v_total_linea, prod.tipo_iva);
    v_total := v_total + v_total_linea;
    v_total_merc := v_total_merc + v_total_linea;
    if prod.tipo_iva = '10%' then v_t10 := v_t10 + v_total_linea; v_i10 := v_i10 + v_iva_linea;
    elsif prod.tipo_iva = '5%' then v_t5 := v_t5 + v_total_linea; v_i5 := v_i5 + v_iva_linea;
    else v_ex := v_ex + v_total_linea; end if;
    if v_con then v_credito_iva := v_credito_iva + v_iva_linea; end if;

    v_oc_item := null;
    if nullif(it->>'oc_item_id', '') is not null then
      if v_oc is null then raise exception 'Producto %: viene de una orden de compra pero falta la orden', v_orden; end if;
      select id, producto_id, cantidad, cantidad_recibida into oci from ordenes_compra_items
       where id = (it->>'oc_item_id')::uuid and orden_compra_id = v_oc for update;
      if not found then
        raise exception 'Producto % ("%"): esa línea ya no está en la orden % (¿la editaron?). Volvé a abrir la recepción', v_orden, prod.nombre, v_oc_row.numero_oc;
      end if;
      if oci.producto_id <> prod.id then
        raise exception 'Producto % ("%"): no corresponde a esa línea de la orden %', v_orden, prod.nombre, v_oc_row.numero_oc;
      end if;
      if oci.cantidad_recibida + v_cant > oci.cantidad and not v_excedente then
        raise exception '"%": pediste %, ya llegaron % y estás recibiendo %. Si de verdad llegó de más, confirmá la recepción excedente',
          prod.nombre, trim_scale(oci.cantidad), trim_scale(oci.cantidad_recibida), trim_scale(v_cant);
      end if;
      update ordenes_compra_items set cantidad_recibida = cantidad_recibida + v_cant
       where id = oci.id
       returning id into v_oc_item;
    end if;

    insert into compras_items (empresa_id, compra_id, producto_id, producto_nombre, producto_sku, cantidad,
                               costo_unitario_original, costo_unitario, tipo_iva, subtotal, monto_iva, total,
                               precio_venta_nuevo, orden, oc_item_id, lote_numero, lote_vencimiento)
      values (v_empresa, v_compra, prod.id, prod.nombre, prod.sku, v_cant, v_costo_orig, v_costo, prod.tipo_iva,
              v_total_linea - v_iva_linea, v_iva_linea, v_total_linea,
              nullif(nullif(it->>'precio_venta_nuevo', '')::numeric, 0), v_orden, v_oc_item, v_lote_num, v_lote_venc)
      returning id into v_item;

    -- Costo promedio ponderado (sobre el stock TOTAL) + precio de venta nuevo.
    v_cpp := case when prod.controla_stock and greatest(prod.stock_actual, 0) + v_cant > 0
                  then round((greatest(prod.stock_actual, 0) * coalesce(prod.costo_promedio, 0) + v_cant * v_costo)
                             / (greatest(prod.stock_actual, 0) + v_cant), 2)
                  else v_costo end;
    v_pv := nullif(nullif(it->>'precio_venta_nuevo', '')::numeric, 0);
    update productos
       set costo_promedio = v_cpp,
           precio_venta = coalesce(v_pv, precio_venta),
           proveedor_principal_id = coalesce(proveedor_principal_id, v_prov_id),
           updated_at = now()
     where id = prod.id;

    if prod.controla_stock then
      perform inv_mover(v_empresa, prod.id, v_dep_id, v_cant, v_costo, 'compra', 'compra', v_compra, v_numero,
                        v_numero || case when v_lote_num is not null
                                         then ' · Lote ' || v_lote_num || ' vence ' || to_char(v_lote_venc, 'DD/MM/YYYY') else '' end,
                        s.s_usuario, s.s_nombre,
                        jsonb_build_object('proveedor', v_prov_nombre, 'numero_factura', v_factura,
                                           'proveedor_id', v_prov_id, 'compra_id', v_compra));
    end if;

    if v_lote_num is not null then
      v_lote := lote_entrada(v_empresa, prod.id, v_dep_id, v_lote_num, v_lote_venc, v_cant, v_costo, 'compra',
                             v_compra, v_numero, 'compra', v_compra, v_item);
      update compras_items set lote_id = v_lote where id = v_item;
    end if;
  end loop;

  -- ── Gastos: subcategoría, descripción, monto (IVA incluido), IVA, deducible, sucursal ──
  select exists (select 1 from empleados where empresa_id = v_empresa and activo) into v_hay_empleados;
  for it in select * from jsonb_array_elements(v_gastos) loop
    v_gorden := v_gorden + 1;
    v_desc := btrim(coalesce(it->>'descripcion', ''));
    v_monto_orig := round(coalesce(nullif(it->>'monto', '')::numeric, 0), v_dec);
    if v_monto_orig <= 0 then raise exception 'Gasto %: el monto tiene que ser mayor a 0', v_gorden; end if;
    v_iva := coalesce(nullif(it->>'iva_tipo', ''), '10%');
    if v_iva = '10' then v_iva := '10%'; elsif v_iva = '5' then v_iva := '5%'; elsif lower(v_iva) in ('exenta', 'exento') then v_iva := 'exenta'; end if;
    if v_iva not in ('10%', '5%', 'exenta') then raise exception 'Gasto %: tipo de IVA inválido (10 %%, 5 %% o exenta)', v_gorden; end if;
    if not v_con then v_iva := 'exenta'; end if;   -- sin comprobante fiscal no se discrimina IVA
    if nullif(it->>'categoria_id', '') is null then raise exception 'Gasto %: elegí la categoría', v_gorden; end if;
    select c.id, c.nombre, c.es_rubro, c.deducible_iva, (c.es_personal or coalesce(rb.es_personal, false)) as es_personal into cat
      from gasto_categorias c left join gasto_categorias rb on rb.id = c.padre_id
     where c.id = (it->>'categoria_id')::uuid and c.empresa_id = v_empresa;
    if not found then raise exception 'Gasto %: la categoría no existe', v_gorden; end if;
    if cat.es_rubro then raise exception 'Gasto %: elegí una subcategoría de "%" (no el rubro)', v_gorden, cat.nombre; end if;
    v_isuc := nullif(it->>'sucursal_id', '')::uuid;
    if v_isuc is not null then
      perform 1 from sucursales where id = v_isuc and empresa_id = v_empresa;
      if not found then raise exception 'Gasto %: sucursal no encontrada', v_gorden; end if;
    end if;
    v_emple := case when cat.es_personal then nullif(it->>'empleado_id', '')::uuid end;
    if v_emple is not null then
      perform 1 from empleados where id = v_emple and empresa_id = v_empresa;
      if not found then raise exception 'Gasto %: empleado no encontrado', v_gorden; end if;
    elsif cat.es_personal and v_hay_empleados then
      raise exception 'Gasto %: las líneas de personal llevan el empleado', v_gorden;
    end if;
    v_monto := round(v_monto_orig * v_cambio);
    if v_monto <= 0 then raise exception 'Gasto %: el monto es muy chico', v_gorden; end if;
    v_iva_linea := case v_iva when '10%' then round(v_monto / 11) when '5%' then round(v_monto / 21) else 0 end;
    v_ded := v_con and coalesce(cat.deducible_iva, true) and v_iva <> 'exenta'
             and coalesce(nullif(it->>'deducible', '')::boolean, true);
    insert into compras_gastos (empresa_id, compra_id, orden, categoria_id, categoria_nombre, descripcion, monto_original, monto,
                                iva_tipo, monto_iva, deducible, sucursal_id, empleado_id)
    values (v_empresa, v_compra, v_gorden, cat.id, cat.nombre, left(coalesce(nullif(v_desc, ''), cat.nombre), 300), v_monto_orig, v_monto,
            v_iva, v_iva_linea, v_ded, coalesce(v_isuc, v_suc), v_emple);
    v_total := v_total + v_monto;
    v_total_gastos := v_total_gastos + v_monto;
    if v_iva = '10%' then v_t10 := v_t10 + v_monto; v_i10 := v_i10 + v_iva_linea;
    elsif v_iva = '5%' then v_t5 := v_t5 + v_monto; v_i5 := v_i5 + v_iva_linea;
    else v_ex := v_ex + v_monto; end if;
    if v_ded then v_credito_iva := v_credito_iva + v_iva_linea; end if;
  end loop;

  if v_total <= 0 then raise exception 'El total tiene que ser mayor a cero'; end if;

  update compras c set subtotal = v_total - v_i10 - v_i5, monto_iva = v_i10 + v_i5, total = v_total,
         total_mercaderia = v_total_merc, total_gastos = v_total_gastos,
         exenta = v_ex, total_5 = v_t5, iva_5 = v_i5, total_10 = v_t10, iva_10 = v_i10, iva_credito = v_credito_iva,
         busqueda = concat_ws(' ', norm(v_numero), compacto(v_numero), norm(v_prov_nombre), norm(v_factura), compacto(v_factura),
                              norm(v_timbrado), norm(v_tipo_comp),
                              (select string_agg(norm(i.producto_nombre) || ' ' || norm(i.producto_sku) || ' ' || compacto(i.producto_sku), ' ')
                                 from compras_items i where i.compra_id = v_compra),
                              (select string_agg(concat_ws(' ', norm(g.descripcion), norm(g.categoria_nombre), norm(rb.nombre), norm(e.nombre)), ' ')
                                 from compras_gastos g
                                 left join gasto_categorias gc on gc.id = g.categoria_id
                                 left join gasto_categorias rb on rb.id = gc.padre_id
                                 left join empleados e on e.id = g.empleado_id
                                where g.compra_id = v_compra))
   where c.id = v_compra;

  if v_caja is not null then
    v_concepto := case when v_tipo = 'gasto' then 'Gasto ' else 'Compra ' end || v_numero || ' · '
                  || coalesce(v_prov_nombre, (select g.descripcion from compras_gastos g where g.compra_id = v_compra order by g.orden limit 1), 'sin comprobante');
    insert into caja_movimientos (empresa_id, caja_id, tipo, concepto, monto, medio_pago, categoria, usuario_id, fecha, compra_id, observacion)
    values (v_empresa, v_caja, 'egreso', left(v_concepto, 200), round(v_total), 'efectivo',
            case when v_tipo = 'gasto' then 'gasto' else 'compra' end,
            s.s_usuario, v_hoy, v_compra, left(coalesce(coalesce(v_tipo_comp, 'Factura') || ' ' || v_factura, ''), 200));
  end if;

  if v_oc is not null then perform recalcular_orden_compra(v_oc); end if;
  return jsonb_build_object('id', v_compra, 'numero_control', v_numero, 'total', v_total, 'tipo', v_tipo,
                            'total_mercaderia', v_total_merc, 'total_gastos', v_total_gastos,
                            'deposito_id', v_dep_id, 'deposito', v_dep_nombre,
                            'caja_id', v_caja);
end;
$fn$;

-- =============================================================================
-- 3. anular_compra — la mercadería vuelve al stock; los gastos se anulan sin tocar stock
-- =============================================================================
create or replace function :"schema".anular_compra(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_empresa uuid;
  c record;
  it record;
  prod record;
  v_cpp numeric;
  l record;
  v_pagado numeric;
  v_ops text;
  v_caja record;
  v_dep uuid;
  v_dep_nombre text;
  v_en_dep numeric;
  v_ref text;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_empresa := s.s_empresa;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la anulación'; end if;
  select * into c from compras where id = p_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Compra no encontrada'; end if;
  if c.estado = 'anulada' then raise exception 'La compra ya está anulada'; end if;
  if exists (select 1 from compras_items where compra_id = c.id) then perform exigir_permiso('anular_compras'); end if;
  if exists (select 1 from compras_gastos where compra_id = c.id) then perform exigir_permiso('anular_gastos'); end if;
  v_dep := coalesce(c.deposito_id, deposito_por_defecto(v_empresa, null));
  select nombre into v_dep_nombre from depositos where id = v_dep;
  v_ref := left('Anulación ' || c.numero_control || ': ' || btrim(p_motivo), 200);

  if c.orden_compra_id is not null then
    perform 1 from ordenes_compra where id = c.orden_compra_id for update;
  end if;

  select x.pagado into v_pagado from cuentas_por_pagar x where x.compra_id = c.id for update;
  if coalesce(v_pagado, 0) > 0 then
    select string_agg(distinct k.numero, ', ' order by k.numero) into v_ops
      from pagos_proveedores_aplicaciones a
      join pagos_proveedores k on k.id = a.pago_id
      join cuentas_por_pagar x on x.id = a.cxp_id
     where x.compra_id = c.id and k.anulado_at is null;
    raise exception 'La compra % ya tiene pagos al proveedor (%): anulá primero esos pagos', c.numero_control, coalesce(v_ops, 'órdenes de pago');
  end if;

  select m.id, cj.estado, cj.numero_caja into v_caja
    from caja_movimientos m join cajas cj on cj.id = m.caja_id
   where m.compra_id = c.id and m.anulado_at is null limit 1;
  if found and v_caja.estado <> 'abierta' then
    raise exception 'El efectivo de esta compra salió de la caja N° %, que ya se cerró: no se puede anular', v_caja.numero_caja;
  end if;

  -- Solo las líneas de MERCADERÍA mueven stock (las de gasto no tienen nada que revertir).
  for it in select * from compras_items where compra_id = c.id order by orden loop
    select * into prod from productos where id = it.producto_id and empresa_id = v_empresa for update;
    if not found or not prod.controla_stock then continue; end if;
    v_en_dep := coalesce((select cantidad from stock_depositos where producto_id = prod.id and deposito_id = v_dep), 0);
    if v_en_dep < it.cantidad then
      raise exception 'No se puede anular: de "%" quedan % en % y la compra trajo %. Ya se vendió o se trasladó parte.',
        prod.nombre, trim_scale(v_en_dep), coalesce(v_dep_nombre, 'el depósito'), trim_scale(it.cantidad);
    end if;
    if it.lote_id is not null then
      select id, numero, cantidad into l from lotes where id = it.lote_id for update;
      if found then
        if l.cantidad < it.cantidad then
          raise exception 'No se puede anular: del lote % de "%" quedan % y la compra trajo %. Ya se vendió, se trasladó o se dio de baja parte.',
            l.numero, prod.nombre, trim_scale(l.cantidad), trim_scale(it.cantidad);
        end if;
        update lotes set cantidad = cantidad - it.cantidad where id = l.id;
        insert into lotes_movimientos (empresa_id, producto_id, lote_id, deposito_id, tipo, cantidad, origen, compra_id, motivo,
                                       documento_tipo, documento_id, documento_item_id)
          values (v_empresa, prod.id, l.id, v_dep, 'SALIDA', it.cantidad, 'anulacion_compra', c.id, left(v_ref, 300),
                  'compra', c.id, it.id);
      end if;
    end if;
    -- Saca la compra del promedio: (stock·cpp − cant·costo) / (stock − cant).
    v_cpp := case when prod.stock_actual - it.cantidad > 0
                  then greatest(round((prod.stock_actual * coalesce(prod.costo_promedio, 0) - it.cantidad * it.costo_unitario)
                                      / (prod.stock_actual - it.cantidad), 2), 0)
                  else prod.costo_promedio end;
    update productos set costo_promedio = v_cpp, updated_at = now() where id = prod.id;
    perform inv_mover(v_empresa, prod.id, v_dep, -it.cantidad, it.costo_unitario, 'anulacion_compra', 'compra', c.id,
                      c.numero_control, v_ref, s.s_usuario, s.s_nombre,
                      jsonb_build_object('proveedor', c.proveedor_nombre, 'numero_factura', c.numero_factura,
                                         'proveedor_id', c.proveedor_id, 'compra_id', c.id));
  end loop;

  update compras set estado = 'anulada', anulada_at = now(), anulada_por = s.s_nombre,
         anulada_motivo = left(btrim(p_motivo), 500)
   where id = c.id;

  update caja_movimientos set anulado_at = now(), anulado_por = s.s_usuario,
         anulado_motivo = left('Compra anulada: ' || btrim(p_motivo), 200)
   where compra_id = c.id and anulado_at is null;

  if c.orden_compra_id is not null then
    update ordenes_compra_items oi set cantidad_recibida = greatest(oi.cantidad_recibida - ci.cantidad, 0)
      from compras_items ci
     where ci.compra_id = c.id and ci.oc_item_id = oi.id;
    perform recalcular_orden_compra(c.orden_compra_id);
  end if;
  return jsonb_build_object('id', c.id, 'numero_control', c.numero_control, 'tipo', c.tipo);
end;
$fn$;

-- =============================================================================
-- 4. Cuenta a pagar de una compra a crédito (la deuda en USD incluye las líneas de gasto)
-- =============================================================================
create or replace function :"schema".tg_compras_cxp()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_pagado numeric;
  v_monto numeric;
begin
  if new.tipo_pago <> 'credito' or new.proveedor_id is null then return null; end if;
  if new.estado = 'anulada' then
    select pagado into v_pagado from cuentas_por_pagar where compra_id = new.id;
    if coalesce(v_pagado, 0) > 0 then
      raise exception 'La compra % ya tiene pagos al proveedor: anulá primero esos pagos', new.numero_control;
    end if;
    update cuentas_por_pagar set estado = 'anulada', updated_at = now() where compra_id = new.id;
    return null;
  end if;
  -- compras.total está en Gs.; la deuda en USD va en dólares: Σ cantidad × costo US$ + Σ gastos US$.
  v_monto := case when new.moneda = 'USD'
                  then coalesce(nullif(coalesce((select round(sum(i.cantidad * i.costo_unitario_original), 2) from compras_items i where i.compra_id = new.id), 0)
                                       + coalesce((select round(sum(g.monto_original), 2) from compras_gastos g where g.compra_id = new.id), 0), 0),
                                round(new.total / nullif(new.tipo_cambio, 0), 2))
                  else new.total end;
  insert into cuentas_por_pagar (empresa_id, compra_id, proveedor_id, numero, fecha_emision, vencimiento, moneda, monto)
  values (new.empresa_id, new.id, new.proveedor_id, coalesce(new.numero_factura, new.numero_control),
          coalesce(new.fecha_factura, (new.fecha at time zone 'America/Asuncion')::date),
          coalesce(new.vencimiento, coalesce(new.fecha_factura, (new.fecha at time zone 'America/Asuncion')::date) + coalesce(new.plazo_dias, 30)),
          new.moneda, coalesce(v_monto, 0))
  on conflict (compra_id) do update
     set monto = excluded.monto, proveedor_id = excluded.proveedor_id, numero = excluded.numero,
         vencimiento = excluded.vencimiento, moneda = excluded.moneda,
         estado = case when cuentas_por_pagar.pagado >= excluded.monto then 'pagada'
                       when cuentas_por_pagar.pagado > 0 then 'parcial' else 'pendiente' end,
         updated_at = now();
  return null;
end;
$fn$;

-- =============================================================================
-- 5. Lista unificada "Compras y gastos" (compras de todo tipo + gastos operativos anteriores)
-- =============================================================================
create or replace function :"schema".listar_compras_gastos(
  p_q text default null, p_tipo text default null, p_estado text default null,
  p_desde date default null, p_hasta date default null, p_sucursal uuid default null,
  p_proveedor uuid default null, p_categoria uuid default null, p_tipo_costo text default null,
  p_deducible boolean default null, p_origen text default null, p_tipo_pago text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  r jsonb;
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := btrim(coalesce(norm(p_q), ''));
  v_qc text := coalesce(compacto(p_q), '');
  v_doc text[] := q_documento(p_q);
  v_monto numeric := q_monto(p_q);
  v_busca boolean := cardinality(tokens_busqueda(p_q)) > 0;
  v_solo boolean := false;
begin
  select * into s from inv_sesion(array['ADMIN']);
  -- Número de documento (COMP-…, GS-…) o N° de factura completo: si existe, SOLO ese.
  if v_busca and (v_doc is not null or length(v_qc) >= 7) then
    v_solo := exists (select 1 from compras c where c.empresa_id = s.s_empresa
                        and ((v_doc is not null and (doc_igual(c.numero_control, v_doc) or doc_serie(c.numero_control, v_doc)))
                             or (length(v_qc) >= 7 and compacto(c.numero_factura) = v_qc)))
           or exists (select 1 from gastos g where g.empresa_id = s.s_empresa
                        and ((v_doc is not null and (doc_igual(g.numero, v_doc) or doc_serie(g.numero, v_doc)))
                             or (length(v_qc) >= 7 and compacto(g.numero_comprobante) = v_qc)));
  end if;

  with cats as (
    select id from gasto_categorias
     where empresa_id = s.s_empresa and p_categoria is not null and (id = p_categoria or padre_id = p_categoria)
  ),
  -- Líneas de gasto de los dos orígenes (para filtrar por categoría, sucursal, fijo/variable, personal).
  lineas as (
    select 'compra'::text as origen, cg.compra_id as doc_id, cg.categoria_id, cg.sucursal_id,
           gc.tipo_costo, coalesce(gc.es_personal, false) or coalesce(rb.es_personal, false) as es_personal
      from compras_gastos cg
      left join gasto_categorias gc on gc.id = cg.categoria_id left join gasto_categorias rb on rb.id = gc.padre_id
     where cg.empresa_id = s.s_empresa
       and (p_categoria is not null or p_sucursal is not null or p_tipo_costo is not null or p_origen = 'personal')
    union all
    select 'gasto', gi.gasto_id, gi.categoria_id, gi.sucursal_id,
           gc.tipo_costo, coalesce(gc.es_personal, false) or coalesce(rb.es_personal, false)
      from gasto_items gi
      left join gasto_categorias gc on gc.id = gi.categoria_id left join gasto_categorias rb on rb.id = gc.padre_id
     where gi.empresa_id = s.s_empresa
       and (p_categoria is not null or p_sucursal is not null or p_tipo_costo is not null or p_origen = 'personal')
  ),
  base as (
    select 'compra'::text as origen, c.id, c.numero_control as numero,
           case when c.estado = 'anulada' then 'anulado' else 'vigente' end as estado,
           c.tipo, coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) as fecha, c.fecha as creado,
           c.proveedor_id, c.proveedor_nombre, pr.ruc as proveedor_ruc,
           c.con_comprobante, c.tipo_comprobante, c.numero_factura as comprobante, c.nro_timbrado as timbrado,
           c.tipo_pago, c.medio_pago, c.vencimiento, c.moneda,
           case when c.moneda = 'USD' then round(c.total / nullif(c.tipo_cambio, 0), 2) else c.total end as total,
           c.total as total_gs, c.total_mercaderia, c.total_gastos, c.iva_credito,
           c.iva_credito > 0 as deducible,
           coalesce(c.sucursal_id, d.sucursal_id) as sucursal_id,
           (select g.descripcion from compras_gastos g where g.compra_id = c.id order by g.orden limit 1) as descripcion,
           c.busqueda, c.anulada_motivo as anulado_motivo, c.usuario_nombre,
           null::uuid as recurrente_id, null::date as fecha_programada, c.orden_compra_id
      from compras c
      left join proveedores pr on pr.id = c.proveedor_id
      left join depositos d on d.id = c.deposito_id
     where c.empresa_id = s.s_empresa
    union all
    select 'gasto', g.id, g.numero,
           case g.estado when 'confirmado' then 'vigente' when 'anulado' then 'anulado' else 'borrador' end,
           'gasto', g.fecha, g.created_at,
           g.proveedor_id, g.proveedor_nombre, g.proveedor_ruc,
           g.con_comprobante, g.tipo_comprobante, g.numero_comprobante, g.timbrado,
           g.tipo_pago, g.medio_pago, g.fecha_vencimiento, g.moneda,
           g.total, g.total_gs, 0::numeric, g.total_gs,
           case when g.deducible then round(coalesce((select sum(i.monto_iva) from gasto_items i where i.gasto_id = g.id and i.deducible), 0) * g.tipo_cambio) else 0 end,
           g.deducible,
           g.sucursal_id, g.descripcion, g.busqueda, g.anulado_motivo, g.usuario_nombre,
           g.recurrente_id, g.fecha_programada, null::uuid
      from gastos g
     where g.empresa_id = s.s_empresa
  ),
  filtradas as (
    select b.*,
           case when not v_busca then 0
                when doc_igual(b.numero, v_doc) then 3000
                when length(v_qc) >= 7 and compacto(b.comprobante) = v_qc then 2500
                when b.total_gs = v_monto or b.total = v_monto then 2000
                when ruc_igual(b.proveedor_ruc, v_qc) then 1500
                else relevancia_busqueda(norm(coalesce(nullif(b.proveedor_nombre, ''), b.descripcion, '')), coalesce(b.busqueda, ''), v_q, v_tk) end as _score
      from base b
     where (p_tipo is null or b.tipo = p_tipo
            or (p_tipo = 'con_gasto' and b.tipo in ('gasto', 'mixta'))
            or (p_tipo = 'con_mercaderia' and b.tipo in ('mercaderia', 'mixta')))
       and (p_estado is null or b.estado = p_estado)
       and (p_desde is null or b.fecha >= p_desde)
       and (p_hasta is null or b.fecha <= p_hasta)
       and (p_proveedor is null or b.proveedor_id = p_proveedor)
       and (p_tipo_pago is null or b.tipo_pago = p_tipo_pago)
       and (p_deducible is null or b.deducible = p_deducible)
       and (p_sucursal is null or b.sucursal_id = p_sucursal
            or exists (select 1 from lineas l where l.origen = b.origen and l.doc_id = b.id and l.sucursal_id = p_sucursal))
       and (p_categoria is null
            or exists (select 1 from lineas l where l.origen = b.origen and l.doc_id = b.id and l.categoria_id in (select id from cats)))
       and (p_tipo_costo is null
            or exists (select 1 from lineas l where l.origen = b.origen and l.doc_id = b.id and l.tipo_costo = p_tipo_costo))
       and (p_origen is null
            or (p_origen = 'recurrente' and b.recurrente_id is not null)
            or (p_origen = 'personal' and exists (select 1 from lineas l where l.origen = b.origen and l.doc_id = b.id and l.es_personal))
            or (p_origen = 'sin_comprobante' and not b.con_comprobante)
            or (p_origen = 'orden_compra' and b.orden_compra_id is not null))
       and (not v_busca
            or (v_solo and (doc_igual(b.numero, v_doc) or (length(v_qc) >= 7 and compacto(b.comprobante) = v_qc)))
            or (not v_solo and (coincide_busqueda(coalesce(b.busqueda, ''), v_tk) or b.total_gs = v_monto or b.total = v_monto)))
  ),
  pagina as (
    select * from filtradas order by _score desc, fecha desc, creado desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'total_monto', (select coalesce(sum(total_gs), 0) from filtradas where estado = 'vigente'),
    'total_mercaderia', (select coalesce(sum(total_mercaderia), 0) from filtradas where estado = 'vigente'),
    'total_gastos', (select coalesce(sum(total_gastos), 0) from filtradas where estado = 'vigente'),
    'total_iva', (select coalesce(sum(iva_credito), 0) from filtradas where estado = 'vigente'),
    'total_borradores', (select coalesce(sum(total_gs), 0) from filtradas where estado = 'borrador'),
    'borradores', (select count(*) from base where estado = 'borrador'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'origen', x.origen, 'id', x.id, 'numero', x.numero, 'estado', x.estado, 'tipo', x.tipo, 'fecha', x.fecha, 'creado', x.creado,
        'proveedor_id', x.proveedor_id, 'proveedor_nombre', x.proveedor_nombre, 'proveedor_ruc', x.proveedor_ruc,
        'con_comprobante', x.con_comprobante, 'tipo_comprobante', x.tipo_comprobante, 'comprobante', x.comprobante,
        'tipo_pago', x.tipo_pago, 'medio_pago', x.medio_pago, 'vencimiento', x.vencimiento,
        'moneda', x.moneda, 'total', x.total, 'total_gs', x.total_gs, 'total_mercaderia', x.total_mercaderia, 'total_gastos', x.total_gastos,
        'iva_credito', x.iva_credito, 'descripcion', x.descripcion,
        'sucursal_id', x.sucursal_id, 'sucursal_nombre', (select su.nombre from sucursales su where su.id = x.sucursal_id),
        'productos', case when x.origen = 'compra' then (select count(*) from compras_items i where i.compra_id = x.id) else 0 end,
        'categorias', case when x.origen = 'compra'
            then (select string_agg(distinct coalesce(rb.nombre || ' › ', '') || g.categoria_nombre, ', ')
                    from compras_gastos g left join gasto_categorias gc on gc.id = g.categoria_id
                    left join gasto_categorias rb on rb.id = gc.padre_id where g.compra_id = x.id)
            else (select string_agg(distinct coalesce(rb.nombre || ' › ', '') || i.categoria_nombre, ', ')
                    from gasto_items i left join gasto_categorias gc on gc.id = i.categoria_id
                    left join gasto_categorias rb on rb.id = gc.padre_id where i.gasto_id = x.id) end,
        'cxp', (select jsonb_build_object('id', c.id, 'saldo', c.saldo, 'pagado', c.pagado, 'estado', c.estado, 'moneda', c.moneda)
                  from cuentas_por_pagar c where (x.origen = 'compra' and c.compra_id = x.id) or (x.origen = 'gasto' and c.gasto_id = x.id) limit 1),
        'oc_numero', (select o.numero_oc from ordenes_compra o where o.id = x.orden_compra_id),
        'adjuntos', case when x.origen = 'gasto' then (select count(*) from gastos_adjuntos a where a.gasto_id = x.id)
                         else (select count(*) from compras_comprobantes a where a.compra_id = x.id) end,
        'recurrente_id', x.recurrente_id, 'fecha_programada', x.fecha_programada,
        'anulado_motivo', x.anulado_motivo, 'usuario_nombre', x.usuario_nombre
      ) order by x._score desc, x.fecha desc, x.creado desc) from pagina x), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 6. Resumen de gastos: mercadería = compras de mercadería; líneas de gasto = gasto operativo
-- =============================================================================
create or replace function :"schema".gastos_resumen(p_desde date default null, p_hasta date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_desde date;
  v_hasta date;
  v_ant_desde date;
  v_ant_hasta date;
  v_mes_ini date;
  v_meses integer;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_desde := coalesce(p_desde, date_trunc('month', v_hoy)::date);
  v_hasta := coalesce(p_hasta, v_hoy);
  if v_hasta < v_desde then raise exception 'El rango de fechas está invertido'; end if;
  if v_hasta - v_desde > 3700 then raise exception 'El rango máximo es de 10 años'; end if;
  if extract(day from v_desde) = 1 then
    v_ant_desde := (v_desde - make_interval(months => greatest(1, (extract(year from age(v_hasta + 1, v_desde)) * 12
                                                                     + extract(month from age(v_hasta + 1, v_desde)))::integer)))::date;
    v_ant_hasta := least((v_ant_desde + (v_hasta - v_desde)), v_desde - 1);
    if (v_hasta + 1) = (date_trunc('month', v_hasta) + interval '1 month')::date then
      v_ant_hasta := v_desde - 1;
    end if;
  else
    v_ant_hasta := v_desde - 1;
    v_ant_desde := v_desde - (v_hasta - v_desde) - 1;
  end if;
  v_meses := least(greatest((extract(year from age(date_trunc('month', v_hasta), date_trunc('month', v_desde))) * 12
                             + extract(month from age(date_trunc('month', v_hasta), date_trunc('month', v_desde))))::integer + 1, 6), 24);
  v_mes_ini := (date_trunc('month', v_hasta) - make_interval(months => v_meses - 1))::date;

  with mov as (
    -- Compras: la parte de MERCADERÍA (una fila por compra; compras.total ya está en Gs.).
    select 'compra'::text as origen, c.id as doc_id, coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) as fecha,
           coalesce(d.sucursal_id, c.sucursal_id) as sucursal_id, c.proveedor_id, c.proveedor_nombre, null::uuid as categoria_id, null::uuid as rubro_id,
           'variable'::text as tipo_costo,
           c.total_mercaderia as monto,
           coalesce((select sum(i.monto_iva) from compras_items i where i.compra_id = c.id), 0) as iva,
           c.con_comprobante as deducible
      from compras c left join depositos d on d.id = c.deposito_id
     where c.empresa_id = s.s_empresa and c.estado = 'registrada' and c.total_mercaderia > 0
    union all
    -- Compras: cada línea de GASTO es gasto operativo (categoría y sucursal de la línea).
    select 'gasto', c.id, coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date),
           coalesce(cg.sucursal_id, c.sucursal_id), c.proveedor_id, c.proveedor_nombre, cg.categoria_id, gc.padre_id,
           coalesce(gc.tipo_costo, 'variable'), cg.monto, cg.monto_iva, cg.deducible
      from compras c join compras_gastos cg on cg.compra_id = c.id left join gasto_categorias gc on gc.id = cg.categoria_id
     where c.empresa_id = s.s_empresa and c.estado = 'registrada'
    union all
    -- Gastos operativos cargados antes de la unificación (o desde recurrentes): una fila por línea.
    select 'gasto', g.id, g.fecha, coalesce(i.sucursal_id, g.sucursal_id), g.proveedor_id, g.proveedor_nombre, i.categoria_id, c.padre_id,
           coalesce(c.tipo_costo, 'variable'), round(i.monto * g.tipo_cambio), round(i.monto_iva * g.tipo_cambio), i.deducible
      from gastos g join gasto_items i on i.gasto_id = g.id left join gasto_categorias c on c.id = i.categoria_id
     where g.empresa_id = s.s_empresa and g.estado = 'confirmado'
  ),
  suc as (select * from mov where p_sucursal is null or sucursal_id = p_sucursal),
  per as (select * from suc where fecha between v_desde and v_hasta),
  ant as (select * from suc where fecha between v_ant_desde and v_ant_hasta),
  pres as (
    select p.categoria_id, coalesce(c.padre_id, c.id) as rubro_id, sum(p.monto) as monto
      from gastos_presupuestos p left join gasto_categorias c on c.id = p.categoria_id
     where p.empresa_id = s.s_empresa and p.periodo between date_trunc('month', v_desde)::date and date_trunc('month', v_hasta)::date
     group by p.categoria_id, coalesce(c.padre_id, c.id)
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta, 'sucursal_id', p_sucursal,
    'totales', (select jsonb_build_object(
        'total', coalesce(sum(monto), 0),
        'compras', coalesce(sum(monto) filter (where origen = 'compra'), 0),
        'operativos', coalesce(sum(monto) filter (where origen = 'gasto'), 0),
        'iva_credito', coalesce(sum(iva) filter (where deducible), 0),
        'no_deducible', coalesce(sum(monto) filter (where not deducible), 0),
        'fijo', coalesce(sum(monto) filter (where tipo_costo = 'fijo'), 0),
        'variable', coalesce(sum(monto) filter (where tipo_costo = 'variable'), 0),
        'docs_compras', count(distinct doc_id) filter (where origen = 'compra'),
        'docs_gastos', count(distinct doc_id) filter (where origen = 'gasto')) from per),
    'anterior', (select jsonb_build_object('desde', v_ant_desde, 'hasta', v_ant_hasta,
        'total', coalesce(sum(monto), 0),
        'compras', coalesce(sum(monto) filter (where origen = 'compra'), 0),
        'operativos', coalesce(sum(monto) filter (where origen = 'gasto'), 0)) from ant),
    'deuda', (select jsonb_build_object(
        'saldo_gs', coalesce(sum(case when x.moneda = 'USD' then round(x.saldo * coalesce(g.tipo_cambio, c.tipo_cambio, 1)) else x.saldo end), 0),
        'vencido_gs', coalesce(sum(case when x.moneda = 'USD' then round(x.saldo * coalesce(g.tipo_cambio, c.tipo_cambio, 1)) else x.saldo end)
                               filter (where x.vencimiento < v_hoy), 0),
        'cuentas', count(*))
      from cuentas_por_pagar x left join gastos g on g.id = x.gasto_id left join compras c on c.id = x.compra_id
      left join depositos d on d.id = c.deposito_id
     where x.empresa_id = s.s_empresa and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and (p_sucursal is null or coalesce(g.sucursal_id, d.sucursal_id, c.sucursal_id) = p_sucursal)),
    'borradores', (select jsonb_build_object('cantidad', count(*), 'total_gs', coalesce(sum(total_gs), 0))
                     from gastos g where g.empresa_id = s.s_empresa and g.estado = 'borrador'
                      and (p_sucursal is null or g.sucursal_id = p_sucursal)),
    'por_rubro', coalesce((
      select jsonb_agg(x order by (x->>'total')::numeric desc) from (
        select jsonb_build_object('id', null, 'nombre', 'Compras de mercadería', 'mercaderia', true,
                 'total', coalesce(sum(monto), 0), 'fijo', 0, 'variable', coalesce(sum(monto), 0),
                 'presupuesto', (select sum(monto) from pres where categoria_id is null),
                 'subcategorias', '[]'::jsonb) as x
          from per where origen = 'compra' having count(*) > 0 or exists (select 1 from pres where categoria_id is null)
        union all
        select jsonb_build_object('id', rb.id, 'nombre', rb.nombre, 'mercaderia', false,
                 'total', coalesce(t.total, 0), 'fijo', coalesce(t.fijo, 0), 'variable', coalesce(t.variable, 0),
                 'presupuesto', (select sum(monto) from pres where rubro_id = rb.id),
                 'subcategorias', coalesce((select jsonb_agg(jsonb_build_object('id', sc.categoria_id, 'nombre', c.nombre, 'total', sc.total)
                                                  order by sc.total desc)
                                             from (select categoria_id, sum(monto) as total from per where rubro_id = rb.id group by categoria_id) sc
                                             join gasto_categorias c on c.id = sc.categoria_id), '[]'::jsonb))
          from gasto_categorias rb
          left join (select rubro_id, sum(monto) as total, sum(monto) filter (where tipo_costo = 'fijo') as fijo,
                            sum(monto) filter (where tipo_costo = 'variable') as variable
                       from per where origen = 'gasto' group by rubro_id) t on t.rubro_id = rb.id
         where rb.empresa_id = s.s_empresa and rb.es_rubro
           and (coalesce(t.total, 0) > 0 or exists (select 1 from pres where rubro_id = rb.id))
      ) q), '[]'::jsonb),
    'por_mes', (select jsonb_agg(jsonb_build_object('mes', m.mes,
        'compras', coalesce((select sum(monto) from suc where origen = 'compra' and date_trunc('month', fecha)::date = m.mes), 0),
        'operativos', coalesce((select sum(monto) from suc where origen = 'gasto' and date_trunc('month', fecha)::date = m.mes), 0),
        'presupuesto', (select sum(p.monto) from gastos_presupuestos p where p.empresa_id = s.s_empresa and p.periodo = m.mes)) order by m.mes)
      from (select (v_mes_ini + make_interval(months => k))::date as mes from generate_series(0, v_meses - 1) k) m),
    'por_sucursal', coalesce((select jsonb_agg(jsonb_build_object('id', x.sucursal_id, 'nombre', coalesce(su.nombre, 'Sin sucursal'),
                         'compras', x.compras, 'operativos', x.operativos, 'total', x.compras + x.operativos) order by x.compras + x.operativos desc)
        from (select sucursal_id, coalesce(sum(monto) filter (where origen = 'compra'), 0) as compras,
                     coalesce(sum(monto) filter (where origen = 'gasto'), 0) as operativos
                from per group by sucursal_id) x left join sucursales su on su.id = x.sucursal_id), '[]'::jsonb),
    'top_proveedores', coalesce((select jsonb_agg(jsonb_build_object('id', x.proveedor_id, 'nombre', x.nombre,
                         'compras', x.compras, 'operativos', x.operativos, 'total', x.total) order by x.total desc)
        from (select proveedor_id, max(coalesce(proveedor_nombre, 'Sin proveedor')) as nombre,
                     coalesce(sum(monto) filter (where origen = 'compra'), 0) as compras,
                     coalesce(sum(monto) filter (where origen = 'gasto'), 0) as operativos, sum(monto) as total
                from per where proveedor_id is not null
               group by proveedor_id order by sum(monto) desc limit 8) x), '[]'::jsonb),
    'presupuesto', (select jsonb_build_object(
        'previsto', coalesce((select sum(monto) from pres), 0),
        'gastado_presupuestado', coalesce((select sum(p2.monto) from per p2
                                            where (p2.origen = 'compra' and exists (select 1 from pres where categoria_id is null))
                                               or (p2.origen = 'gasto' and exists (select 1 from pres where rubro_id = p2.rubro_id))), 0))),
    'sucursales', coalesce((select jsonb_agg(jsonb_build_object('id', su.id, 'nombre', su.nombre) order by su.es_principal desc, su.nombre)
                            from sucursales su where su.empresa_id = s.s_empresa and su.activa), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 7. Presupuesto: lo gastado incluye las líneas de gasto de las compras
-- =============================================================================
create or replace function :"schema".presupuesto_gastos(p_periodo date)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_per date := date_trunc('month', coalesce(p_periodo, (now() at time zone 'America/Asuncion')::date))::date;
  v_fin date;
  v_ant date;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN']);
  v_fin := (v_per + interval '1 month - 1 day')::date;
  v_ant := (v_per - interval '1 month')::date;
  with gastado as (
    select categoria_id, sum(monto) as monto from (
      select i.categoria_id, round(i.monto * g.tipo_cambio) as monto
        from gastos g join gasto_items i on i.gasto_id = g.id
       where g.empresa_id = s.s_empresa and g.estado = 'confirmado' and g.fecha between v_per and v_fin
      union all
      select cg.categoria_id, cg.monto
        from compras c join compras_gastos cg on cg.compra_id = c.id
       where c.empresa_id = s.s_empresa and c.estado = 'registrada'
         and coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) between v_per and v_fin
    ) x group by categoria_id
  ),
  pres as (select categoria_id, monto from gastos_presupuestos where empresa_id = s.s_empresa and periodo = v_per),
  pant as (select categoria_id, monto from gastos_presupuestos where empresa_id = s.s_empresa and periodo = v_ant)
  select jsonb_build_object(
    'periodo', v_per,
    'mercaderia', jsonb_build_object(
       'previsto', (select monto from pres where categoria_id is null),
       'anterior', (select monto from pant where categoria_id is null),
       'gastado', (select coalesce(sum(c.total_mercaderia), 0)
                     from compras c where c.empresa_id = s.s_empresa and c.estado = 'registrada'
                      and coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) between v_per and v_fin)),
    'rubros', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rb.id, 'nombre', rb.nombre,
        'previsto', (select monto from pres where categoria_id = rb.id),
        'anterior', (select monto from pant where categoria_id = rb.id),
        'gastado', coalesce((select sum(gs.monto) from gastado gs join gasto_categorias c on c.id = gs.categoria_id where c.padre_id = rb.id), 0),
        'subcategorias', coalesce((select jsonb_agg(jsonb_build_object(
            'id', c.id, 'nombre', c.nombre, 'tipo_costo', c.tipo_costo,
            'previsto', (select monto from pres where categoria_id = c.id),
            'anterior', (select monto from pant where categoria_id = c.id),
            'gastado', coalesce((select monto from gastado where categoria_id = c.id), 0)) order by c.orden, c.nombre)
          from gasto_categorias c where c.padre_id = rb.id and (c.activo or exists (select 1 from pres where categoria_id = c.id))), '[]'::jsonb)
      ) order by rb.orden, rb.nombre)
      from gasto_categorias rb where rb.empresa_id = s.s_empresa and rb.es_rubro and rb.activo), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 8. Catálogos de gastos: usos y "lo último por proveedor" también desde las compras
-- =============================================================================
create or replace function :"schema".gastos_catalogos(p_todas boolean default false)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  r jsonb;
begin
  select * into s from inv_sesion(array['ADMIN']);
  select jsonb_build_object(
    'rubros', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rb.id, 'nombre', rb.nombre, 'orden', rb.orden, 'activo', rb.activo, 'es_personal', rb.es_personal,
        'subcategorias', coalesce((select jsonb_agg(jsonb_build_object(
            'id', c.id, 'nombre', c.nombre, 'orden', c.orden, 'activo', c.activo, 'tipo_costo', c.tipo_costo,
            'deducible_iva', c.deducible_iva, 'es_personal', c.es_personal or rb.es_personal,
            'usos', (select count(*) from gasto_items i where i.categoria_id = c.id)
                    + (select count(*) from compras_gastos g where g.categoria_id = c.id)) order by c.orden, c.nombre)
          from gasto_categorias c where c.padre_id = rb.id and (p_todas or c.activo)), '[]'::jsonb)
      ) order by rb.orden, rb.nombre)
      from gasto_categorias rb where rb.empresa_id = s.s_empresa and rb.es_rubro and (p_todas or rb.activo)), '[]'::jsonb),
    'sucursales', coalesce((select jsonb_agg(jsonb_build_object('id', su.id, 'nombre', su.nombre, 'es_principal', su.es_principal, 'activa', su.activa)
                              order by su.es_principal desc, su.nombre)
                            from sucursales su where su.empresa_id = s.s_empresa and (p_todas or su.activa)), '[]'::jsonb),
    'empleados', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'ci', e.ci, 'cargo', e.cargo,
                              'sucursal_id', e.sucursal_id, 'activo', e.activo) order by e.activo desc, e.nombre)
                           from empleados e where e.empresa_id = s.s_empresa and (p_todas or e.activo)), '[]'::jsonb),
    'cuentas_bancarias', coalesce((select jsonb_agg(jsonb_build_object('id', cb.id, 'banco_id', cb.banco_id, 'banco_nombre', cb.banco_nombre,
                              'numero', cb.numero, 'moneda', cb.moneda, 'titular', cb.titular, 'alias', cb.alias, 'activa', cb.activa)
                              order by cb.activa desc, cb.banco_nombre, cb.numero)
                           from cuentas_bancarias cb where cb.empresa_id = s.s_empresa and (p_todas or cb.activa)), '[]'::jsonb),
    'bancos', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'nombre', b.nombre) order by b.orden, b.nombre)
                        from bancos b where b.empresa_id = s.s_empresa and b.activo), '[]'::jsonb),
    'ultimos', coalesce((select jsonb_object_agg(u.proveedor_id, jsonb_build_object(
                  'categoria_id', u.categoria_id, 'sucursal_id', u.sucursal_id, 'tipo_comprobante', u.tipo_comprobante,
                  'timbrado', u.timbrado, 'tipo_pago', u.tipo_pago, 'medio_pago', u.medio_pago, 'plazo_dias', u.plazo_dias,
                  'iva_tipo', u.iva_tipo, 'descripcion', u.descripcion, 'cuenta_bancaria_id', u.cuenta_bancaria_id, 'moneda', u.moneda))
                from (select distinct on (x.proveedor_id) x.*
                        from (select g.proveedor_id, i.categoria_id, g.sucursal_id, g.tipo_comprobante, g.timbrado,
                                     g.tipo_pago, g.medio_pago, g.plazo_dias, i.iva_tipo, i.descripcion, g.cuenta_bancaria_id, g.moneda,
                                     g.fecha, g.created_at
                                from gastos g join gasto_items i on i.gasto_id = g.id and i.orden = 1
                               where g.empresa_id = s.s_empresa and g.proveedor_id is not null and g.estado <> 'anulado'
                              union all
                              select c.proveedor_id, cg.categoria_id, c.sucursal_id, c.tipo_comprobante, c.nro_timbrado,
                                     c.tipo_pago, c.medio_pago, c.plazo_dias, cg.iva_tipo, cg.descripcion, c.cuenta_bancaria_id, c.moneda,
                                     coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date), c.created_at
                                from compras c join compras_gastos cg on cg.compra_id = c.id and cg.orden = 1
                               where c.empresa_id = s.s_empresa and c.proveedor_id is not null and c.estado <> 'anulada') x
                       order by x.proveedor_id, x.fecha desc, x.created_at desc) u), '{}'::jsonb),
    'mi_sucursal_id', gasto_sucursal_defecto(s.s_empresa, s.s_sucursal)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 9. Reportes (54): mercadería vs. gasto sin contar doble; compras.total ya en Gs.
-- =============================================================================

-- Estado de cuenta / P&L: reusa gastos_resumen; flujo de caja separa lo contado de compras
-- (solo mercadería) y de gastos (gastos anteriores + líneas de gasto de las compras).
create or replace function :"schema".reporte_estado_cuenta(p_desde date default null, p_hasta date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g record;
  ga jsonb;
  v_mes_ini date;
  v_fin timestamptz;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], p_sucursal);
  select * into g from rep_rango(p_desde, p_hasta);
  v_fin := rep_ts(g.r_hasta + 1);
  ga := gastos_resumen(g.r_desde, g.r_hasta, s.s_sucursal);
  v_mes_ini := least(g.r_desde, (select min((x->>'mes')::date) from jsonb_array_elements(ga->'por_mes') x));

  with vi as (
    select (v.fecha at time zone 'America/Asuncion')::date as dia,
           vi.total_linea * rep_fx(v.moneda, v.tipo_cambio) as monto,
           vi.monto_iva * rep_fx(v.moneda, v.tipo_cambio) as iva,
           vi.cantidad * coalesce(vi.costo_unitario, 0) * rep_fx(v.moneda, v.tipo_cambio) as costo,
           vi.producto_id, coalesce(vi.costo_unitario, 0) = 0 and vi.producto_id is not null as sin_costo, v.id as venta_id
      from ventas v join ventas_items vi on vi.venta_id = v.id
     where v.empresa_id = s.s_empresa and v.estado <> 'anulada'
       and v.fecha >= rep_ts(v_mes_ini) and v.fecha < v_fin
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
  ),
  per as (select * from vi where dia >= g.r_desde),
  perd as (select * from rep_perdidas_base(s.s_empresa, s.s_sucursal, rep_ts(v_mes_ini), v_fin)),
  perd_per as (select * from perd where dia >= g.r_desde),
  cxc as (
    select x.monto - coalesce((select sum(a.monto) from cobros_aplicaciones a join cobros_clientes c on c.id = a.cobro_id
                                where a.cxc_id = x.id and c.anulado_at is null and c.fecha < v_fin), 0) as saldo,
           x.vencimiento
      from cuentas_por_cobrar x join ventas v on v.id = x.venta_id
     where x.empresa_id = s.s_empresa and x.estado <> 'anulada' and x.fecha_emision <= g.r_hasta
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
  ),
  cxp as (
    select (x.monto - coalesce((select sum(a.monto) from pagos_proveedores_aplicaciones a join pagos_proveedores p on p.id = a.pago_id
                                 where a.cxp_id = x.id and p.anulado_at is null and p.fecha < v_fin), 0))
           * case when x.moneda = 'USD' then coalesce(gg.tipo_cambio, co.tipo_cambio, 1) else 1 end as saldo,
           x.vencimiento
      from cuentas_por_pagar x
      left join gastos gg on gg.id = x.gasto_id
      left join compras co on co.id = x.compra_id
      left join depositos d on d.id = co.deposito_id
     where x.empresa_id = s.s_empresa and x.estado <> 'anulada' and x.fecha_emision <= g.r_hasta
       and (s.s_sucursal is null or coalesce(gg.sucursal_id, d.sucursal_id, co.sucursal_id) = s.s_sucursal)
  ),
  cobrado as (
    select 'ventas_contado' as concepto, d.monto * rep_fx(v.moneda, v.tipo_cambio) as monto
      from ventas v join ventas_pagos_detalle d on d.venta_id = v.id
     where v.empresa_id = s.s_empresa and v.estado <> 'anulada' and v.tipo_venta <> 'CREDITO'
       and v.fecha >= rep_ts(g.r_desde) and v.fecha < v_fin
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
    union all
    select 'ventas_contado', v.total * rep_fx(v.moneda, v.tipo_cambio)
      from ventas v
     where v.empresa_id = s.s_empresa and v.estado <> 'anulada' and v.tipo_venta <> 'CREDITO'
       and v.fecha >= rep_ts(g.r_desde) and v.fecha < v_fin
       and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)
       and not exists (select 1 from ventas_pagos_detalle d where d.venta_id = v.id)
    union all
    select 'cobros', c.total from cobros_clientes c
     where s.s_sucursal is null and c.empresa_id = s.s_empresa and c.anulado_at is null
       and c.fecha >= rep_ts(g.r_desde) and c.fecha < v_fin
    union all
    select 'cobros', a.monto from cobros_clientes c join cobros_aplicaciones a on a.cobro_id = c.id
      join cuentas_por_cobrar x on x.id = a.cxc_id join ventas v on v.id = x.venta_id
     where s.s_sucursal is not null and c.empresa_id = s.s_empresa and c.anulado_at is null
       and c.fecha >= rep_ts(g.r_desde) and c.fecha < v_fin and coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal
  ),
  pagado as (
    select 'compras_contado' as concepto, c.total_mercaderia as monto
      from compras c left join depositos d on d.id = c.deposito_id
     where c.empresa_id = s.s_empresa and c.estado = 'registrada' and coalesce(c.tipo_pago, 'contado') = 'contado'
       and c.total_mercaderia > 0
       and coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) between g.r_desde and g.r_hasta
       and (s.s_sucursal is null or coalesce(d.sucursal_id, c.sucursal_id) = s.s_sucursal)
    union all
    select 'gastos_contado', cg.monto
      from compras c join compras_gastos cg on cg.compra_id = c.id
     where c.empresa_id = s.s_empresa and c.estado = 'registrada' and coalesce(c.tipo_pago, 'contado') = 'contado'
       and coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) between g.r_desde and g.r_hasta
       and (s.s_sucursal is null or coalesce(cg.sucursal_id, c.sucursal_id) = s.s_sucursal)
    union all
    select 'gastos_contado', round(i.monto * g2.tipo_cambio)
      from gastos g2 join gasto_items i on i.gasto_id = g2.id
     where g2.empresa_id = s.s_empresa and g2.estado = 'confirmado' and coalesce(g2.tipo_pago, 'contado') = 'contado'
       and g2.fecha between g.r_desde and g.r_hasta
       and (s.s_sucursal is null or coalesce(i.sucursal_id, g2.sucursal_id) = s.s_sucursal)
    union all
    select 'pagos_proveedores', round(a.monto * case when x.moneda = 'USD' then coalesce(gg.tipo_cambio, co.tipo_cambio, 1) else 1 end)
      from pagos_proveedores p join pagos_proveedores_aplicaciones a on a.pago_id = p.id
      join cuentas_por_pagar x on x.id = a.cxp_id
      left join gastos gg on gg.id = x.gasto_id left join compras co on co.id = x.compra_id left join depositos d on d.id = co.deposito_id
     where p.empresa_id = s.s_empresa and p.anulado_at is null and p.fecha >= rep_ts(g.r_desde) and p.fecha < v_fin
       and (s.s_sucursal is null or coalesce(gg.sucursal_id, d.sucursal_id, co.sucursal_id) = s.s_sucursal)
  ),
  meses as (select (x->>'mes')::date as mes, (x->>'compras')::numeric as compras, (x->>'operativos')::numeric as operativos
              from jsonb_array_elements(ga->'por_mes') x),
  vi_mes as (select date_trunc('month', dia)::date as mes, sum(monto) as ventas, sum(costo) as cmv from vi group by 1),
  perd_mes as (select date_trunc('month', dia)::date as mes, sum(valor) as perdidas from perd group by 1)
  select jsonb_build_object(
    'desde', g.r_desde, 'hasta', g.r_hasta, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, true, s.s_sucursal),
    'ventas', (select jsonb_build_object(
        'netas', round(coalesce(sum(monto), 0)), 'iva', round(coalesce(sum(iva), 0)), 'cmv', round(coalesce(sum(costo), 0)),
        'cantidad', count(distinct venta_id), 'productos_sin_costo', count(distinct producto_id) filter (where sin_costo))
      from per),
    'anuladas', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(v.total * rep_fx(v.moneda, v.tipo_cambio)), 0))
                   from ventas v where v.empresa_id = s.s_empresa and v.estado = 'anulada'
                    and v.fecha >= rep_ts(g.r_desde) and v.fecha < v_fin
                    and (s.s_sucursal is null or coalesce(v.sucursal_id, s.s_principal) = s.s_sucursal)),
    'gastos', jsonb_build_object(
        'compras', (ga->'totales'->>'compras')::numeric, 'operativos', (ga->'totales'->>'operativos')::numeric,
        'iva_credito', (ga->'totales'->>'iva_credito')::numeric, 'fijo', (ga->'totales'->>'fijo')::numeric,
        'docs_compras', (ga->'totales'->>'docs_compras')::numeric, 'docs_gastos', (ga->'totales'->>'docs_gastos')::numeric,
        'por_rubro', coalesce((select jsonb_agg(jsonb_build_object('id', x->'id', 'nombre', x->'nombre', 'total', x->'total') order by (x->>'total')::numeric desc)
                                 from jsonb_array_elements(ga->'por_rubro') x where not (x->>'mercaderia')::boolean and (x->>'total')::numeric > 0), '[]'::jsonb)),
    'perdidas', (select jsonb_build_object(
        'total', coalesce(sum(valor), 0), 'unidades', coalesce(sum(unidades), 0),
        'pe', coalesce(sum(valor) filter (where origen = 'perdida'), 0), 'traslados', coalesce(sum(valor) filter (where origen = 'traslado'), 0),
        'por_motivo', coalesce((select jsonb_agg(jsonb_build_object('motivo', motivo, 'label', rep_motivo_perdida(motivo), 'valor', t) order by t desc)
                                  from (select motivo, sum(valor) t from perd_per group by motivo) x), '[]'::jsonb))
      from perd_per),
    'cxc', (select jsonb_build_object('saldo', coalesce(sum(saldo) filter (where saldo > 0), 0),
                                      'vencido', coalesce(sum(saldo) filter (where saldo > 0 and vencimiento < g.r_hasta), 0)) from cxc),
    'cxp', (select jsonb_build_object('saldo', round(coalesce(sum(saldo) filter (where saldo > 0), 0)),
                                      'vencido', round(coalesce(sum(saldo) filter (where saldo > 0 and vencimiento < g.r_hasta), 0))) from cxp),
    'flujo', jsonb_build_object(
        'ventas_contado', (select round(coalesce(sum(monto), 0)) from cobrado where concepto = 'ventas_contado'),
        'cobros', (select round(coalesce(sum(monto), 0)) from cobrado where concepto = 'cobros'),
        'compras_contado', (select coalesce(sum(monto), 0) from pagado where concepto = 'compras_contado'),
        'gastos_contado', (select coalesce(sum(monto), 0) from pagado where concepto = 'gastos_contado'),
        'pagos_proveedores', (select coalesce(sum(monto), 0) from pagado where concepto = 'pagos_proveedores')),
    'por_mes', (select jsonb_agg(jsonb_build_object(
        'mes', m.mes, 'ventas', round(coalesce(vm.ventas, 0)), 'cmv', round(coalesce(vm.cmv, 0)),
        'compras', m.compras, 'operativos', m.operativos, 'perdidas', coalesce(pm.perdidas, 0)) order by m.mes)
      from meses m left join vi_mes vm on vm.mes = m.mes left join perd_mes pm on pm.mes = m.mes)
  ) into r;
  return r;
end;
$fn$;

-- Proveedores: "compras" = la parte de mercadería; "gastos" = gastos anteriores + líneas de
-- gasto de las compras.
create or replace function :"schema".reporte_proveedores(p_desde date default null, p_hasta date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], p_sucursal);
  select * into g from rep_rango(p_desde, p_hasta);

  with co as (
    select c.proveedor_id, coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) as fecha,
           c.total_mercaderia as total
      from compras c left join depositos d on d.id = c.deposito_id
     where c.empresa_id = s.s_empresa and c.estado = 'registrada' and c.total_mercaderia > 0
       and (s.s_sucursal is null or coalesce(d.sucursal_id, c.sucursal_id) = s.s_sucursal)
  ),
  co_per as (
    select proveedor_id, sum(total) as total, count(*) as n from co where fecha between g.r_desde and g.r_hasta group by proveedor_id
  ),
  co_ult as (select proveedor_id, max(fecha) as ultima from co group by proveedor_id),
  ga_lineas as (
    select g2.proveedor_id, g2.id as doc_id, round(i.monto * g2.tipo_cambio) as monto
      from gastos g2 join gasto_items i on i.gasto_id = g2.id
     where g2.empresa_id = s.s_empresa and g2.estado = 'confirmado' and g2.proveedor_id is not null
       and g2.fecha between g.r_desde and g.r_hasta
       and (s.s_sucursal is null or coalesce(i.sucursal_id, g2.sucursal_id) = s.s_sucursal)
    union all
    select c.proveedor_id, c.id, cg.monto
      from compras c join compras_gastos cg on cg.compra_id = c.id
     where c.empresa_id = s.s_empresa and c.estado = 'registrada' and c.proveedor_id is not null
       and coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) between g.r_desde and g.r_hasta
       and (s.s_sucursal is null or coalesce(cg.sucursal_id, c.sucursal_id) = s.s_sucursal)
  ),
  ga as (select proveedor_id, sum(monto) as total, count(distinct doc_id) as n from ga_lineas group by proveedor_id),
  deuda as (
    select x.proveedor_id,
           sum(case when x.moneda = 'USD' then round(x.saldo * coalesce(gg.tipo_cambio, cc.tipo_cambio, 1)) else x.saldo end) as saldo_gs,
           sum(case when x.moneda = 'USD' then round(x.saldo * coalesce(gg.tipo_cambio, cc.tipo_cambio, 1)) else x.saldo end)
             filter (where x.vencimiento < v_hoy) as vencido_gs,
           sum(x.saldo) filter (where x.moneda = 'USD') as saldo_usd
      from cuentas_por_pagar x left join gastos gg on gg.id = x.gasto_id left join compras cc on cc.id = x.compra_id
      left join depositos d on d.id = cc.deposito_id
     where x.empresa_id = s.s_empresa and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and (s.s_sucursal is null or coalesce(gg.sucursal_id, d.sucursal_id, cc.sucursal_id) = s.s_sucursal)
     group by x.proveedor_id
  ),
  prods as (select proveedor_principal_id as id, count(*) as n from productos
             where empresa_id = s.s_empresa and activo and proveedor_principal_id is not null group by proveedor_principal_id),
  filas as (
    select p.id, p.nombre, p.nombre_comercial, p.ruc, p.telefono, p.activo,
           coalesce(cp.total, 0) as compras, coalesce(cp.n, 0) as compras_cant, cu.ultima as ultima_compra,
           coalesce(ga.total, 0) as gastos, coalesce(ga.n, 0) as gastos_cant,
           coalesce(de.saldo_gs, 0) as deuda_gs, coalesce(de.vencido_gs, 0) as vencido_gs, coalesce(de.saldo_usd, 0) as deuda_usd,
           coalesce(pr.n, 0) as productos
      from proveedores p
      left join co_per cp on cp.proveedor_id = p.id
      left join co_ult cu on cu.proveedor_id = p.id
      left join ga on ga.proveedor_id = p.id
      left join deuda de on de.proveedor_id = p.id
      left join prods pr on pr.id = p.id
     where p.empresa_id = s.s_empresa
       and (p.activo or cp.n > 0 or ga.n > 0 or de.saldo_gs > 0)
  )
  select jsonb_build_object(
    'desde', g.r_desde, 'hasta', g.r_hasta, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, true, s.s_sucursal),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by f.compras desc, f.gastos desc, f.nombre) from filas f), '[]'::jsonb),
    'totales', (select jsonb_build_object(
        'compras', coalesce(sum(compras), 0), 'compras_cant', coalesce(sum(compras_cant), 0), 'gastos', coalesce(sum(gastos), 0),
        'deuda_gs', coalesce(sum(deuda_gs), 0), 'vencido_gs', coalesce(sum(vencido_gs), 0), 'deuda_usd', coalesce(sum(deuda_usd), 0),
        'proveedores_con_compras', count(*) filter (where compras_cant > 0),
        'compras_sin_proveedor', (select coalesce(sum(total), 0) from co where proveedor_id is null and fecha between g.r_desde and g.r_hasta))
      from filas)
  ) into r;
  return r;
end;
$fn$;

-- Ficha de un proveedor: kpis/meses de compras = mercadería; gastos = gastos + líneas de gasto.
create or replace function :"schema".reporte_proveedor(p_proveedor uuid, p_desde date default null, p_hasta date default null, p_sucursal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  g record;
  pr record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_mes_ini date;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], p_sucursal);
  select * into g from rep_rango(p_desde, p_hasta);
  select * into pr from proveedores where id = p_proveedor and empresa_id = s.s_empresa;
  if not found then raise exception 'Proveedor no encontrado'; end if;
  v_mes_ini := (date_trunc('month', g.r_hasta) - interval '11 months')::date;

  with co as (
    select c.id, c.numero_control, c.numero_factura, c.tipo_pago, c.moneda, c.total, c.estado, c.tipo,
           coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) as fecha,
           c.total as total_gs, c.total_mercaderia as mercaderia_gs, c.total_gastos as gastos_gs,
           d.nombre as deposito_nombre, su.nombre as sucursal_nombre
      from compras c left join depositos d on d.id = c.deposito_id
      left join sucursales su on su.id = coalesce(d.sucursal_id, c.sucursal_id)
     where c.empresa_id = s.s_empresa and c.proveedor_id = p_proveedor
       and (s.s_sucursal is null or coalesce(d.sucursal_id, c.sucursal_id) = s.s_sucursal)
  ),
  vivas as (select * from co where estado = 'registrada' and mercaderia_gs > 0),
  ci as (
    select ci.producto_id, ci.producto_nombre, ci.producto_sku, ci.cantidad, ci.costo_unitario as costo_gs,
           ci.total as total_gs, vv.fecha, vv.id as compra_id
      from compras_items ci join vivas vv on vv.id = ci.compra_id
  ),
  prod as (
    select p.id, p.nombre, p.sku, p.stock_actual, p.costo_promedio, p.precio_venta, p.activo,
           p.proveedor_principal_id = p_proveedor as principal,
           (select max(ci.fecha) from ci where ci.producto_id = p.id) as ultima_compra,
           (select ci.costo_gs from ci where ci.producto_id = p.id order by ci.fecha desc, ci.compra_id limit 1) as ultimo_costo,
           coalesce((select sum(ci.cantidad) from ci where ci.producto_id = p.id and ci.fecha between g.r_desde and g.r_hasta), 0) as cantidad,
           coalesce((select sum(ci.total_gs) from ci where ci.producto_id = p.id and ci.fecha between g.r_desde and g.r_hasta), 0) as monto,
           coalesce((select count(distinct ci.compra_id) from ci where ci.producto_id = p.id and ci.fecha between g.r_desde and g.r_hasta), 0) as compras
      from productos p
     where p.empresa_id = s.s_empresa
       and (p.proveedor_principal_id = p_proveedor or p.id in (select producto_id from ci where producto_id is not null))
  ),
  cxp as (
    select x.id, x.numero, x.moneda, x.monto, x.pagado, x.saldo, x.fecha_emision, x.vencimiento, x.estado,
           case when x.compra_id is not null then 'compra' else 'gasto' end as origen, coalesce(x.compra_id, x.gasto_id) as doc_id,
           coalesce(cc.numero_control, gg.numero) as documento,
           greatest(v_hoy - x.vencimiento, 0) as dias_atraso,
           case when x.moneda = 'USD' then round(x.saldo * coalesce(gg.tipo_cambio, cc.tipo_cambio, 1)) else x.saldo end as saldo_gs
      from cuentas_por_pagar x left join compras cc on cc.id = x.compra_id left join gastos gg on gg.id = x.gasto_id
      left join depositos d on d.id = cc.deposito_id
     where x.empresa_id = s.s_empresa and x.proveedor_id = p_proveedor and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and (s.s_sucursal is null or coalesce(gg.sucursal_id, d.sucursal_id, cc.sucursal_id) = s.s_sucursal)
  ),
  ga as (
    select g2.id, g2.numero, g2.fecha, g2.descripcion, round(i.monto * g2.tipo_cambio) as monto
      from gastos g2 join gasto_items i on i.gasto_id = g2.id
     where g2.empresa_id = s.s_empresa and g2.proveedor_id = p_proveedor and g2.estado = 'confirmado'
       and g2.fecha between least(g.r_desde, v_mes_ini) and g.r_hasta
       and (s.s_sucursal is null or coalesce(i.sucursal_id, g2.sucursal_id) = s.s_sucursal)
    union all
    select c.id, c.numero_control, coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date), cg.descripcion, cg.monto
      from compras c join compras_gastos cg on cg.compra_id = c.id
     where c.empresa_id = s.s_empresa and c.proveedor_id = p_proveedor and c.estado = 'registrada'
       and coalesce(c.fecha_factura, (c.fecha at time zone 'America/Asuncion')::date) between least(g.r_desde, v_mes_ini) and g.r_hasta
       and (s.s_sucursal is null or coalesce(cg.sucursal_id, c.sucursal_id) = s.s_sucursal)
  )
  select jsonb_build_object(
    'desde', g.r_desde, 'hasta', g.r_hasta, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, true, s.s_sucursal),
    'proveedor', jsonb_build_object('id', pr.id, 'nombre', pr.nombre, 'nombre_comercial', pr.nombre_comercial, 'ruc', pr.ruc,
        'telefono', pr.telefono, 'email', pr.email, 'contacto', pr.contacto, 'ciudad', pr.ciudad, 'condicion_pago', pr.condicion_pago,
        'plazo_pago_dias', pr.plazo_pago_dias, 'moneda', pr.moneda, 'activo', pr.activo),
    'kpis', (select jsonb_build_object(
        'compras', coalesce(sum(mercaderia_gs) filter (where fecha between g.r_desde and g.r_hasta), 0),
        'compras_cant', count(*) filter (where fecha between g.r_desde and g.r_hasta),
        'ultima_compra', max(fecha), 'primera_compra', min(fecha), 'compras_historicas', coalesce(sum(mercaderia_gs), 0),
        'gastos', (select coalesce(sum(monto), 0) from ga where fecha between g.r_desde and g.r_hasta),
        'deuda_gs', (select coalesce(sum(saldo_gs), 0) from cxp),
        'vencido_gs', (select coalesce(sum(saldo_gs), 0) from cxp where dias_atraso > 0),
        'deuda_usd', (select coalesce(sum(saldo), 0) from cxp where moneda = 'USD'),
        'pagado', (select coalesce(sum(p.total), 0) from pagos_proveedores p where p.empresa_id = s.s_empresa and p.proveedor_id = p_proveedor
                     and p.anulado_at is null and p.moneda = 'GS' and p.fecha >= rep_ts(g.r_desde) and p.fecha < rep_ts(g.r_hasta + 1)))
      from vivas),
    'compras', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'numero_control', c.numero_control, 'numero_factura', c.numero_factura, 'fecha', c.fecha, 'tipo_pago', c.tipo_pago,
        'moneda', c.moneda, 'total', c.total, 'total_gs', c.total_gs, 'estado', c.estado, 'tipo', c.tipo, 'sucursal_nombre', c.sucursal_nombre,
        'mercaderia_gs', c.mercaderia_gs, 'gastos_gs', c.gastos_gs,
        'deposito_nombre', c.deposito_nombre, 'items', (select count(*) from compras_items x where x.compra_id = c.id),
        'saldo', (select x.saldo from cuentas_por_pagar x where x.compra_id = c.id and x.estado in ('pendiente', 'parcial')))
        order by c.fecha desc, c.numero_control desc)
        from co c where c.fecha between g.r_desde and g.r_hasta), '[]'::jsonb),
    'productos', coalesce((select jsonb_agg(to_jsonb(x) order by x.monto desc, x.principal desc, x.nombre) from prod x), '[]'::jsonb),
    'por_mes', (select jsonb_agg(jsonb_build_object('mes', m,
        'compras', coalesce((select sum(mercaderia_gs) from vivas where date_trunc('month', fecha)::date = m), 0),
        'operativos', coalesce((select sum(monto) from ga where date_trunc('month', fecha)::date = m), 0)) order by m)
      from (select (v_mes_ini + make_interval(months => k))::date as m from generate_series(0, 11) k) mm),
    'cuentas', coalesce((select jsonb_agg(to_jsonb(x) order by x.vencimiento, x.numero) from cxp x), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'numero', p.numero, 'fecha', p.fecha, 'moneda', p.moneda,
        'total', p.total, 'anulado', p.anulado_at is not null,
        'medios', (select coalesce(jsonb_agg(jsonb_build_object('metodo', m.metodo, 'monto', m.monto)), '[]'::jsonb) from pagos_proveedores_medios m where m.pago_id = p.id))
        order by p.fecha desc)
        from pagos_proveedores p where p.empresa_id = s.s_empresa and p.proveedor_id = p_proveedor
         and p.fecha >= rep_ts(g.r_desde) and p.fecha < rep_ts(g.r_hasta + 1)), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;

-- Cuentas a pagar: una compra sin depósito (solo gastos) se imputa a su sucursal.
create or replace function :"schema".reporte_cxp(p_desde date default null, p_hasta date default null, p_sucursal uuid default null, p_proveedor uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  r jsonb;
begin
  select * into s from rep_sesion(array['ADMIN'], p_sucursal);
  if p_desde is not null and p_hasta is not null and p_hasta < p_desde then raise exception 'El rango de fechas está invertido'; end if;

  with c as (
    select x.id, x.proveedor_id, pr.nombre as proveedor_nombre, pr.ruc as proveedor_ruc, pr.telefono as proveedor_telefono,
           case when x.compra_id is not null then 'compra' else 'gasto' end as origen, coalesce(x.compra_id, x.gasto_id) as doc_id,
           coalesce(cc.numero_control, gg.numero, x.numero) as documento, coalesce(cc.numero_factura, gg.numero_comprobante) as factura,
           coalesce(gg.descripcion, (select g3.descripcion from compras_gastos g3 where g3.compra_id = cc.id order by g3.orden limit 1), '') as descripcion,
           x.fecha_emision, x.vencimiento, x.moneda, x.monto, x.pagado, x.saldo,
           case when x.moneda = 'USD' then coalesce(gg.tipo_cambio, cc.tipo_cambio, 1) else 1 end as tc,
           greatest(v_hoy - x.vencimiento, 0) as dias_atraso, x.vencimiento - v_hoy as dias_para_vencer,
           coalesce(gg.sucursal_id, d.sucursal_id, cc.sucursal_id) as sucursal_id
      from cuentas_por_pagar x
      join proveedores pr on pr.id = x.proveedor_id
      left join compras cc on cc.id = x.compra_id
      left join gastos gg on gg.id = x.gasto_id
      left join depositos d on d.id = cc.deposito_id
     where x.empresa_id = s.s_empresa and x.estado in ('pendiente', 'parcial') and x.saldo > 0
       and (p_proveedor is null or x.proveedor_id = p_proveedor)
       and (p_desde is null or x.fecha_emision >= p_desde) and (p_hasta is null or x.fecha_emision <= p_hasta)
       and (s.s_sucursal is null or coalesce(gg.sucursal_id, d.sucursal_id, cc.sucursal_id) = s.s_sucursal)
  ),
  f as (
    select c.*, round(c.saldo * c.tc) as saldo_gs,
           case when c.dias_atraso = 0 then 'al_dia' when c.dias_atraso <= 30 then 'd1_30' when c.dias_atraso <= 60 then 'd31_60'
                when c.dias_atraso <= 90 then 'd61_90' else 'd90' end as tramo
      from c
  )
  select jsonb_build_object(
    'hoy', v_hoy, 'sucursal_id', s.s_sucursal,
    'sucursales', rep_sucursales(s.s_empresa, true, s.s_sucursal),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by f.vencimiento, f.documento) from f), '[]'::jsonb),
    'por_moneda', coalesce((select jsonb_object_agg(moneda, j) from (
        select moneda, jsonb_build_object(
          'saldo', sum(saldo), 'saldo_gs', sum(saldo_gs), 'cuentas', count(*),
          'vencido', coalesce(sum(saldo) filter (where dias_atraso > 0), 0),
          'al_dia', coalesce(sum(saldo) filter (where tramo = 'al_dia'), 0), 'd1_30', coalesce(sum(saldo) filter (where tramo = 'd1_30'), 0),
          'd31_60', coalesce(sum(saldo) filter (where tramo = 'd31_60'), 0), 'd61_90', coalesce(sum(saldo) filter (where tramo = 'd61_90'), 0),
          'd90', coalesce(sum(saldo) filter (where tramo = 'd90'), 0),
          'vence_7', coalesce(sum(saldo) filter (where dias_atraso = 0 and dias_para_vencer <= 7), 0)) as j
          from f group by moneda) x), '{}'::jsonb),
    'tramos_gs', (select jsonb_build_object(
        'al_dia', coalesce(sum(saldo_gs) filter (where tramo = 'al_dia'), 0), 'd1_30', coalesce(sum(saldo_gs) filter (where tramo = 'd1_30'), 0),
        'd31_60', coalesce(sum(saldo_gs) filter (where tramo = 'd31_60'), 0), 'd61_90', coalesce(sum(saldo_gs) filter (where tramo = 'd61_90'), 0),
        'd90', coalesce(sum(saldo_gs) filter (where tramo = 'd90'), 0), 'total', coalesce(sum(saldo_gs), 0),
        'vencido', coalesce(sum(saldo_gs) filter (where dias_atraso > 0), 0),
        'compras', coalesce(sum(saldo_gs) filter (where origen = 'compra'), 0), 'gastos', coalesce(sum(saldo_gs) filter (where origen = 'gasto'), 0),
        'proveedores', count(distinct proveedor_id)) from f),
    'por_proveedor', coalesce((select jsonb_agg(to_jsonb(x) order by x.saldo_gs desc) from (
        select proveedor_id as id, max(proveedor_nombre) as nombre, max(proveedor_telefono) as telefono, count(*) as cuentas,
               sum(saldo_gs) as saldo_gs, coalesce(sum(saldo_gs) filter (where dias_atraso > 0), 0) as vencido_gs,
               coalesce(sum(saldo) filter (where moneda = 'USD'), 0) as saldo_usd,
               coalesce(sum(saldo_gs) filter (where tramo = 'al_dia'), 0) as al_dia, coalesce(sum(saldo_gs) filter (where tramo = 'd1_30'), 0) as d1_30,
               coalesce(sum(saldo_gs) filter (where tramo = 'd31_60'), 0) as d31_60, coalesce(sum(saldo_gs) filter (where tramo = 'd61_90'), 0) as d61_90,
               coalesce(sum(saldo_gs) filter (where tramo = 'd90'), 0) as d90,
               min(vencimiento) filter (where dias_atraso = 0) as proximo_vencimiento, max(dias_atraso) as max_atraso
          from f group by proveedor_id) x), '[]'::jsonb),
    'calendario', (select jsonb_agg(jsonb_build_object('desde', v_hoy + k * 7, 'hasta', v_hoy + k * 7 + 6,
        'saldo_gs', coalesce((select sum(saldo_gs) from f where vencimiento between v_hoy + k * 7 and v_hoy + k * 7 + 6), 0)) order by k)
      from generate_series(0, 7) k)
  ) into r;
  return r;
end;
$fn$;

-- =============================================================================
-- 10. Permisos de funciones
-- =============================================================================
revoke execute on function :"schema".tg_compras_cxp() from public, anon, authenticated;
do $grants$
declare f text;
begin
  foreach f in array array[
    'registrar_compra(jsonb)', 'anular_compra(uuid, text)',
    'listar_compras_gastos(text, text, text, date, date, uuid, uuid, uuid, text, boolean, text, text, integer, integer)',
    'gastos_resumen(date, date, uuid)', 'presupuesto_gastos(date)', 'gastos_catalogos(boolean)',
    'reporte_estado_cuenta(date, date, uuid)', 'reporte_proveedores(date, date, uuid)',
    'reporte_proveedor(uuid, date, date, uuid)', 'reporte_cxp(date, date, uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$grants$;

commit;
