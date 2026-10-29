-- =============================================================================
-- VENTA A CRÉDITO EN CUOTAS (pedido del dueño, 29-oct-2026).
--
-- En Caja › Nueva venta, "Crédito" pasa de un solo campo "30" (que era el plazo en días) a:
--   · Cuotas: 1 a 60.
--   · 1ª cuota a N días (ventas.plazo_dias, como siempre: lo que trae el cliente o el default).
--   · Cada: mes (mismo día de cada mes) · quincena (15 días) · semana (7 días).
-- Cada cuota es una CUENTA POR COBRAR propia (cuentas_por_cobrar: cuota i de n, su monto y su
-- vencimiento), así cobros, cobranza (cuotas vencidas, tramos de mora), cuentas a cobrar,
-- deudores y estado de cuenta ya las ven una por una sin cambios. Montos iguales; la última
-- absorbe el redondeo (Gs. enteros, US$ con 2 decimales). 1 cuota = exactamente como antes.
--
-- Cambios:
--   · ventas.cuotas / ventas.cuotas_cada; cuentas_por_cobrar.cuota / .cuotas; la única
--     uq_cxc_venta (venta) pasa a (venta, cuota). Número de la cuenta: "V-000123 · 2/3".
--   · tg_ventas_cxc: genera las cuotas; si la venta cambia (total / cuotas / plazo) y no tiene
--     cobros, las regenera; con cobros no deja cambiar las cuotas. Anular: igual que antes.
--   · crear_venta y los cobros de mesa / pedido de mostrador: + p_cuotas, p_cuotas_cada (con
--     default: los llamados de siempre siguen igual).
--   · cxc_venta(venta): resumen de las cuotas de una venta (próximo vencimiento, cobrado, saldo,
--     saldo vencido, estado, cuotas pagadas). Lo usan reporte_ventas_credito y resumen_turno (una
--     fila por venta); documentos_cliente muestra una fila por cuota.
-- IDEMPOTENTE. Va después de 97.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Columnas
-- =============================================================================
alter table :"schema".ventas add column if not exists cuotas integer not null default 1;
alter table :"schema".ventas add column if not exists cuotas_cada text not null default 'mes';
alter table :"schema".ventas drop constraint if exists chk_ventas_cuotas;
alter table :"schema".ventas add constraint chk_ventas_cuotas check (cuotas between 1 and 60);
alter table :"schema".ventas drop constraint if exists chk_ventas_cuotas_cada;
alter table :"schema".ventas add constraint chk_ventas_cuotas_cada check (cuotas_cada in ('mes', 'quincena', 'semana'));
comment on column :"schema".ventas.cuotas is 'Crédito: en cuántas cuotas (1 = un solo vencimiento a plazo_dias). Receta 98.';
comment on column :"schema".ventas.cuotas_cada is 'Crédito en cuotas: mes (mismo día de cada mes) · quincena (15 días) · semana (7 días). La 1ª vence a plazo_dias. Receta 98.';

alter table :"schema".cuentas_por_cobrar add column if not exists cuota integer not null default 1;
alter table :"schema".cuentas_por_cobrar add column if not exists cuotas integer not null default 1;
drop index if exists :"schema".uq_cxc_venta;
create unique index if not exists uq_cxc_venta_cuota on :"schema".cuentas_por_cobrar (venta_id, cuota);
comment on column :"schema".cuentas_por_cobrar.cuota is 'Número de cuota (1..cuotas) de la venta. Receta 98.';

-- =============================================================================
-- 2. Cuotas de la venta (trigger)
-- =============================================================================
create or replace function :"schema".tg_ventas_cxc()
returns trigger language plpgsql set search_path = :"schema", public as $fn$
declare
  v_plazo integer;
  v_cobrado numeric;
  v_filas integer;
  v_n integer := greatest(coalesce(new.cuotas, 1), 1);
  v_fecha date := (new.fecha at time zone 'America/Asuncion')::date;
  v_primera date;
  v_dec integer := case when coalesce(new.moneda, 'GS') = 'GS' then 0 else 2 end;
  v_base numeric;
  v_acum numeric := 0;
  v_monto numeric;
  i integer;
begin
  if new.tipo_venta <> 'CREDITO' or new.cliente_id is null then
    return null;
  end if;
  if new.estado = 'anulada' then
    select coalesce(sum(cobrado), 0) into v_cobrado from cuentas_por_cobrar where venta_id = new.id;
    if v_cobrado > 0 then
      raise exception 'La venta % ya tiene cobros: anulá primero los recibos de ese cliente', new.numero_control;
    end if;
    update cuentas_por_cobrar set estado = 'anulada', updated_at = now() where venta_id = new.id;
    return null;
  end if;
  -- 61: sin plazo en la venta ni en el cliente → "Días de vencimiento por defecto".
  select coalesce(new.plazo_dias, c.plazo_dias, dias_vencimiento_default(new.empresa_id)) into v_plazo
    from clientes c where c.id = new.cliente_id;
  v_plazo := coalesce(v_plazo, dias_vencimiento_default(new.empresa_id));
  v_primera := v_fecha + v_plazo;

  select count(*), coalesce(sum(cobrado), 0) into v_filas, v_cobrado from cuentas_por_cobrar where venta_id = new.id;

  -- Una sola cuota (como siempre): se actualiza la cuenta que ya existe (conserva lo cobrado).
  if v_n = 1 and v_filas = 1 then
    update cuentas_por_cobrar
       set monto = new.total, cliente_id = new.cliente_id, numero = new.numero_control, cuota = 1, cuotas = 1,
           estado = estado_cxc(new.total, cobrado, false), updated_at = now()
     where venta_id = new.id;
    return null;
  end if;

  if v_filas > 0 then
    if tg_op = 'UPDATE' and new.total is not distinct from old.total and new.cuotas is not distinct from old.cuotas
       and new.cuotas_cada is not distinct from old.cuotas_cada and new.plazo_dias is not distinct from old.plazo_dias then
      update cuentas_por_cobrar set cliente_id = new.cliente_id, updated_at = now() where venta_id = new.id;
      return null;
    end if;
    if v_cobrado > 0 then
      raise exception 'La venta % ya tiene cobros: no se pueden cambiar su total ni sus cuotas', new.numero_control;
    end if;
    delete from cuentas_por_cobrar where venta_id = new.id;
  end if;

  v_base := trunc(new.total / v_n, v_dec);
  for i in 1..v_n loop
    v_monto := case when i = v_n then new.total - v_acum else v_base end;
    v_acum := v_acum + v_monto;
    insert into cuentas_por_cobrar (empresa_id, venta_id, cliente_id, numero, fecha_emision, vencimiento, monto, cuota, cuotas)
      values (new.empresa_id, new.id, new.cliente_id,
              case when v_n = 1 then new.numero_control else new.numero_control || ' · ' || i || '/' || v_n end,
              v_fecha,
              case coalesce(new.cuotas_cada, 'mes')
                when 'quincena' then v_primera + 15 * (i - 1)
                when 'semana' then v_primera + 7 * (i - 1)
                else (v_primera + make_interval(months => i - 1))::date end,
              v_monto, i, v_n);
  end loop;
  return null;
end;
$fn$;

drop trigger if exists trg_ventas_cxc on :"schema".ventas;
create trigger trg_ventas_cxc after insert or update of total, estado, cliente_id, tipo_venta, plazo_dias, cuotas, cuotas_cada
  on :"schema".ventas for each row execute function :"schema".tg_ventas_cxc();

-- Resumen de las cuotas de una venta (una fila; ninguna si la venta no tiene cuenta por cobrar).
create or replace function :"schema".cxc_venta(p_venta uuid)
returns table (id uuid, vencimiento date, monto numeric, cobrado numeric, saldo numeric, estado text,
               cuotas integer, cuotas_pagadas integer, saldo_vencido numeric)
language sql stable security definer set search_path = :"schema", public as $$
  select (array_agg(x.id order by (x.estado in ('pendiente', 'parcial')) desc, x.vencimiento, x.cuota))[1],
         coalesce(min(x.vencimiento) filter (where x.estado in ('pendiente', 'parcial')), max(x.vencimiento)),
         sum(x.monto), sum(x.cobrado), sum(x.saldo),
         case when bool_and(x.estado = 'anulada') then 'anulada'
              when bool_and(x.estado in ('pagada', 'anulada')) then 'pagada'
              when sum(x.cobrado) > 0 then 'parcial'
              else 'pendiente' end,
         count(*)::integer,
         (count(*) filter (where x.estado = 'pagada'))::integer,
         coalesce(sum(x.saldo) filter (where x.estado in ('pendiente', 'parcial')
                                          and x.vencimiento < (now() at time zone 'America/Asuncion')::date), 0)
    from cuentas_por_cobrar x
   where x.venta_id = p_venta
  having count(*) > 0
$$;
revoke all on function :"schema".cxc_venta(uuid) from public, anon, authenticated;
grant execute on function :"schema".cxc_venta(uuid) to service_role;

-- =============================================================================
-- 3. crear_venta y los cobros de mesa / pedido: + p_cuotas, p_cuotas_cada
-- =============================================================================
do $do$
declare
  f record;
  v_def text;
  v_new text;
  v_sig regprocedure;
begin
  for f in
    select p.oid, p.proname from pg_proc p
     where p.pronamespace = current_schema()::regnamespace
       and p.proname in ('crear_venta', 'mesa_cuenta_cobrar_caja', 'mesa_cuenta_parte_cobrar_caja', 'pedido_mostrador_cobrar_caja')
       and pg_get_function_identity_arguments(p.oid) not like '%p_cuotas%'
  loop
    v_def := pg_get_functiondef(f.oid);
    -- Cabecera (la primera aparición es la lista de parámetros).
    v_new := regexp_replace(v_def, '(p_cliente_ocasional boolean( DEFAULT false)?)\)',
                            '\1, p_cuotas integer DEFAULT 1, p_cuotas_cada text DEFAULT ''mes''::text)');
    if v_new = v_def then raise exception 'Parche 98: % no tiene la cabecera esperada', f.proname; end if;
    if f.proname = 'crear_venta' then
      v_def := v_new;
      v_new := replace(v_def,
        $a$      raise exception 'El plazo del crédito tiene que estar entre 1 y 3650 días';
    end if;$a$,
        $b$      raise exception 'El plazo del crédito tiene que estar entre 1 y 3650 días';
    end if;
    -- 98: cuotas.
    if coalesce(p_cuotas, 1) < 1 or coalesce(p_cuotas, 1) > 60 then
      raise exception 'Las cuotas van de 1 a 60';
    end if;
    if coalesce(nullif(p_cuotas_cada, ''), 'mes') not in ('mes', 'quincena', 'semana') then
      raise exception 'La frecuencia de las cuotas es mensual, quincenal o semanal';
    end if;$b$);
      if v_new = v_def then raise exception 'Parche 98: crear_venta sin la validación del plazo'; end if;
      v_def := v_new;
      v_new := replace(v_def, 'sucursal_id, punto_venta_id, tipo_documento, receptor_ocasional)',
                              'sucursal_id, punto_venta_id, tipo_documento, receptor_ocasional, cuotas, cuotas_cada)');
      if v_new = v_def then raise exception 'Parche 98: crear_venta sin el insert esperado'; end if;
      v_def := v_new;
      v_new := replace(v_def, 'v_caja.sucursal_id, v_caja.punto_venta_id, v_doc, v_ocasional)',
                              'v_caja.sucursal_id, v_caja.punto_venta_id, v_doc, v_ocasional,
            case when v_tipo = ''CREDITO'' then coalesce(p_cuotas, 1) else 1 end, coalesce(nullif(p_cuotas_cada, ''''), ''mes''))');
      if v_new = v_def then raise exception 'Parche 98: crear_venta sin los values esperados'; end if;
    else
      v_def := v_new;
      v_new := replace(v_def, 'p_tipo_documento, p_cliente_ocasional);', 'p_tipo_documento, p_cliente_ocasional, p_cuotas, p_cuotas_cada);');
      if v_new = v_def then raise exception 'Parche 98: % no llama a crear_venta como se esperaba', f.proname; end if;
    end if;
    execute 'drop function ' || f.oid::regprocedure::text;
    execute v_new;
    select p.oid::regprocedure into v_sig from pg_proc p
     where p.pronamespace = current_schema()::regnamespace and p.proname = f.proname;
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end;
$do$;

-- =============================================================================
-- 4. Consultas que eran "una cuenta por venta"
-- =============================================================================
do $do$
declare
  c record;
  v_def text;
  v_nueva text;
begin
  perform extensions.similarity('a', 'b');   -- por si alguna lleva SET pg_trgm.* (ver 97)
  for c in select * from (values
      -- Ventas a crédito: una fila por venta con el resumen de sus cuotas.
      ('reporte_ventas_credito', 'left join cuentas_por_cobrar cx on cx.venta_id = v.id', 'left join lateral cxc_venta(v.id) cx on true'),
      ('reporte_ventas_credito', 'coalesce(cx.saldo, 0) as saldo,',
       'coalesce(cx.saldo, 0) as saldo, coalesce(cx.cuotas, v.cuotas) as cuotas, coalesce(cx.cuotas_pagadas, 0) as cuotas_pagadas, coalesce(cx.saldo_vencido, 0) as saldo_vencido, v.cuotas_cada,'),
      ('reporte_ventas_credito', $a$'vencido', coalesce(sum(saldo) filter (where vencida), 0)$a$, $b$'vencido', coalesce(sum(saldo_vencido) filter (where vencida), 0)$b$),
      -- Cierre / resumen del turno.
      ('resumen_turno', 'left join cuentas_por_cobrar cx on cx.venta_id = v.id', 'left join lateral cxc_venta(v.id) cx on true'),
      ('resumen_turno', $a$'estado_cuenta', cx.estado$a$, $b$'estado_cuenta', cx.estado, 'cuotas', v.cuotas, 'cuotas_cada', v.cuotas_cada$b$),
      -- Documentos del cliente: una fila por cuota (con su número "V-… · 2/3" y su monto).
      ('documentos_cliente', 'select v.id, v.numero_control as numero,', 'select v.id, coalesce(x.numero, v.numero_control) as numero,'),
      ('documentos_cliente', 'v.total as monto,', 'case when x.cuotas > 1 then x.monto else v.total end as monto, coalesce(x.cuota, 1) as cuota, coalesce(x.cuotas, 1) as cuotas,')
    ) x(fn, patron, nuevo)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = c.fn;
    if v_def is null then raise exception 'Parche 98: no existe %', c.fn; end if;
    if position(c.nuevo in v_def) > 0 then continue; end if;
    if position(c.patron in v_def) = 0 then raise exception 'Parche 98: % no tiene el patrón esperado: %', c.fn, c.patron; end if;
    v_nueva := replace(v_def, c.patron, c.nuevo);
    execute v_nueva;
  end loop;
end;
$do$;

commit;
