-- =============================================================================
-- CORREGIR EL MÉTODO DE PAGO DE UNA VENTA (pedido del socio del dueño, 30-oct-2026).
--
--   · corregir_pago_venta: cambia el método (y su referencia / banco) de cada pago de una venta al
--     contado. El monto y el total no cambian. Motivo obligatorio y queda el registro de quién
--     cambió qué en ventas_pagos_correcciones: pasar efectivo a tarjeta saca plata del arqueo.
--   · Permisos, los mismos de anular: 'anular_ventas'; turno cerrado, además 'anular_ventas_cerradas'.
--   · Turno abierto: se corrigen también los movimientos, así el arqueo espera lo correcto.
--   · Turno cerrado: el arqueo queda como se cerró (igual que al anular); cambian la venta y los
--     reportes. Por eso anular_venta ahora toma el efectivo a devolver de los pagos de la venta y no
--     de los movimientos del turno cerrado, que ya no siempre coinciden.
--   · Pagos con saldo a favor y ventas a crédito no se corrigen.
--
-- IDEMPOTENTE. Va después de 108.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create table if not exists :"schema".ventas_pagos_correcciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  venta_id uuid not null references :"schema".ventas(id) on delete cascade,
  usuario_id uuid,
  usuario_nombre text,
  motivo text not null,
  antes jsonb not null,
  despues jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ventas_pagos_correcciones_venta_idx on :"schema".ventas_pagos_correcciones (venta_id, created_at);
alter table :"schema".ventas_pagos_correcciones enable row level security;
alter table :"schema".ventas_pagos_correcciones force row level security;
drop policy if exists ventas_pagos_correcciones_propias on :"schema".ventas_pagos_correcciones;
create policy ventas_pagos_correcciones_propias on :"schema".ventas_pagos_correcciones for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
grant select on :"schema".ventas_pagos_correcciones to authenticated, service_role;

create or replace function :"schema".corregir_pago_venta(p_venta_id uuid, p_cambios jsonb, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to :"schema", public
as $f$
declare
  s record;
  v record;
  d record;
  c jsonb;
  v_cerrado boolean := false;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_metodo text;
  v_ref text;
  v_banco text;
  v_mov uuid;
  v_antes jsonb := '[]'::jsonb;
  v_despues jsonb := '[]'::jsonb;
  v_metodos text[];
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  perform exigir_permiso('anular_ventas');
  if v_motivo is null then raise exception 'Escribí el motivo de la corrección'; end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'array' then raise exception 'No cambiaste nada'; end if;

  select * into v from ventas where id = p_venta_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v.estado = 'anulada' then raise exception 'La venta % está anulada', v.numero_control; end if;
  if v.tipo_venta = 'CREDITO' then raise exception 'La venta % es a crédito: no tiene forma de pago para corregir', v.numero_control; end if;
  if not (alcance_todas() or tiene_permiso('anular_ventas_cerradas')) and v.sucursal_id is not null
     and v.sucursal_id <> coalesce(s.s_sucursal, sucursal_principal(s.s_empresa)) then
    raise exception 'La venta es de otra sucursal: no la podés corregir';
  end if;
  if v.caja_id is not null then
    select c2.estado <> 'abierta' into v_cerrado from cajas c2 where c2.id = v.caja_id;
    v_cerrado := coalesce(v_cerrado, false);
  end if;
  if v_cerrado and not tiene_permiso('anular_ventas_cerradas') then
    raise exception 'La venta es de un turno que ya se cerró: tu perfil no permite corregirla';
  end if;

  for c in select * from jsonb_array_elements(p_cambios) loop
    select * into d from ventas_pagos_detalle where id = (c->>'id')::uuid and venta_id = p_venta_id for update;
    if not found then raise exception 'Ese pago no es de esta venta'; end if;
    v_metodo := lower(btrim(coalesce(c->>'metodo_pago', '')));
    if d.metodo_pago = 'saldo_favor' then
      if v_metodo <> 'saldo_favor' then raise exception 'El pago con saldo a favor no se corrige: anulá la venta'; end if;
      continue;
    end if;
    if v_metodo not in ('efectivo', 'tarjeta_debito', 'tarjeta_credito', 'transferencia', 'qr', 'cheque') then
      raise exception 'Forma de pago inválida: %', v_metodo;
    end if;
    v_ref := nullif(btrim(coalesce(c->>'referencia', '')), '');
    v_banco := nullif(btrim(coalesce(c->>'banco', '')), '');
    if v_metodo = 'efectivo' then v_ref := null; v_banco := null; end if;
    if v_metodo = d.metodo_pago and v_ref is not distinct from d.referencia and v_banco is not distinct from d.banco then
      continue;
    end if;

    v_antes := v_antes || jsonb_build_object('metodo_pago', d.metodo_pago, 'monto', d.monto, 'referencia', d.referencia, 'banco', d.banco);
    v_despues := v_despues || jsonb_build_object('metodo_pago', v_metodo, 'monto', d.monto, 'referencia', v_ref, 'banco', v_banco);

    update ventas_pagos_detalle
       set metodo_pago = v_metodo, referencia = v_ref, banco = v_banco,
           recibido = case when v_metodo = 'efectivo' and d.metodo_pago = 'efectivo' then d.recibido end,
           vuelto = case when v_metodo = 'efectivo' and d.metodo_pago = 'efectivo' then d.vuelto else 0 end
     where id = d.id;

    if not v_cerrado and v.caja_id is not null then
      select m.id into v_mov from caja_movimientos m
       where m.venta_id = p_venta_id and m.caja_id = v.caja_id and m.tipo = 'ingreso' and m.anulado_at is null
         and m.monto = d.monto and metodo_caja(coalesce(m.metodo, m.medio_pago)) = metodo_caja(d.metodo_pago)
       order by m.created_at, m.id limit 1;
      if found then
        update caja_movimientos
           set metodo = metodo_caja(v_metodo), medio_pago = medio_caja(v_metodo), referencia = v_ref, banco = v_banco,
               concepto = left('Venta ' || v.numero_control || ' · ' || metodo_caja_label(v_metodo), 200)
         where id = v_mov;
      end if;
    end if;
  end loop;

  if jsonb_array_length(v_antes) = 0 then raise exception 'No cambiaste nada'; end if;

  select array_agg(distinct metodo_caja(metodo_pago)) into v_metodos from ventas_pagos_detalle where venta_id = p_venta_id;
  update ventas set metodo_pago = case when array_length(v_metodos, 1) > 1 then 'mixto' else v_metodos[1] end, updated_at = now()
   where id = p_venta_id;

  if not v_cerrado and v.caja_id is not null and caja_efectivo_esperado(v.caja_id) < 0 then
    raise exception 'El efectivo de la caja quedaría en negativo: revisá los retiros del turno';
  end if;

  insert into ventas_pagos_correcciones (empresa_id, venta_id, usuario_id, usuario_nombre, motivo, antes, despues)
    values (s.s_empresa, p_venta_id, s.s_usuario, s.s_nombre, v_motivo, v_antes, v_despues);

  return jsonb_build_object('venta_id', p_venta_id, 'turno_cerrado', v_cerrado);
end;
$f$;
grant execute on function :"schema".corregir_pago_venta(uuid, jsonb, text) to authenticated, service_role;

do $do$
declare
  r record;
  v_oid oid;
  v_def text;
begin
  for r in select * from (values
    ('select coalesce(sum(monto), 0) into v_efectivo from caja_movimientos', 'select coalesce(sum(monto), 0) into v_efectivo from ventas_pagos_detalle'),
    ('where venta_id = p_venta_id and tipo = ''ingreso'' and medio_pago = ''efectivo'' and anulado_at is null;', 'where venta_id = p_venta_id and metodo_pago = ''efectivo'';')
  ) as t(patron, nuevo) loop
    select p.oid into v_oid from pg_proc p where p.proname = 'anular_venta' and p.pronamespace = current_schema()::regnamespace;
    v_def := pg_get_functiondef(v_oid);
    if position(r.nuevo in v_def) > 0 then continue; end if;
    if position(r.patron in v_def) = 0 then raise exception 'anular_venta: no encuentro "%"', r.patron; end if;
    execute replace(v_def, r.patron, r.nuevo);
  end loop;
end;
$do$;

notify pgrst, 'reload schema';
commit;
