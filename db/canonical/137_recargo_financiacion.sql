-- =============================================================================
-- RECARGO POR FINANCIACIÓN EN LOS PLANES DE CUOTAS (pendiente de la 131, 4-nov-2026).
--
--   · planes_cuota.recargo_pct: % que se suma sobre lo financiado (total − entrega). 0 = sin
--     recargo (como hasta ahora).
--   · Al vender con un plan que tiene recargo (caja: crear_venta_cuotas; inmobiliaria y API:
--     vender_en_cuotas → también propiedad_vender) se agrega a la MISMA venta un renglón manual
--     "Recargo por financiación (plan X)", con el IVA de los intereses (facturacion_config.mora_iva,
--     10 % por defecto). El total sube, y las cuotas (no la entrega) lo absorben.
--   · La entrega mínima del plan se sigue calculando sobre el precio, sin el recargo.
--
-- IDEMPOTENTE. Va después de 136.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

alter table :"schema".planes_cuota add column if not exists recargo_pct numeric(6,2) not null default 0;
alter table :"schema".planes_cuota drop constraint if exists chk_planes_cuota_recargo;
alter table :"schema".planes_cuota add constraint chk_planes_cuota_recargo check (recargo_pct between 0 and 300);
comment on column :"schema".planes_cuota.recargo_pct is 'Recargo % sobre lo financiado (total − entrega). Receta 137.';

-- Interna: agrega el renglón del recargo a la venta y sube sus totales. Devuelve el recargo.
create or replace function :"schema".recargo_plan_cuotas(p_venta uuid, p_plan uuid, p_entrega numeric)
returns numeric language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  pl planes_cuota;
  v ventas;
  v_recargo numeric;
  v_iva_tipo text;
  v_tasa numeric;
  v_iva numeric;
begin
  if p_plan is null then return 0; end if;
  select * into pl from planes_cuota where id = p_plan;
  if pl.id is null or pl.recargo_pct <= 0 then return 0; end if;
  select * into v from ventas where id = p_venta;
  if v.empresa_id is distinct from pl.empresa_id then raise exception 'El plan no es de esta empresa'; end if;
  v_recargo := round((v.total - coalesce(p_entrega, 0)) * pl.recargo_pct / 100);
  if v_recargo <= 0 then return 0; end if;
  select coalesce(mora_iva, '10%') into v_iva_tipo from facturacion_config where empresa_id = v.empresa_id;
  v_iva_tipo := coalesce(v_iva_tipo, '10%');
  v_tasa := case v_iva_tipo when '10%' then 10 when '5%' then 5 else 0 end;
  v_iva := case when v_tasa = 0 then 0 else round(v_recargo * v_tasa / (100 + v_tasa)) end;
  insert into ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta_original,
                            precio_venta, tipo_precio, tipo_iva, subtotal, monto_iva, total_linea, es_manual, costo_unitario)
  values (v.empresa_id, p_venta, null, 'Recargo por financiación (' || pl.nombre || ', ' || trim_scale(pl.recargo_pct) || ' %)',
          null, 1, v_recargo, v_recargo, 'minorista', v_iva_tipo, v_recargo - v_iva, v_iva, v_recargo, true, 0);
  -- El disparador de cuentas a cobrar rearma las cuotas con el total nuevo (todavía no hay cobros).
  update ventas set subtotal = subtotal + (v_recargo - v_iva), monto_iva = monto_iva + v_iva, total = total + v_recargo, updated_at = now()
   where id = p_venta;
  return v_recargo;
end;
$fn$;
revoke all on function :"schema".recargo_plan_cuotas(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function :"schema".recargo_plan_cuotas(uuid, uuid, numeric) to service_role;

-- La lista y el guardado de planes llevan el recargo.
do $do$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('planes_cuota_lista()'::regprocedure);
  if position('-- 137: recargo' in v_def) = 0 then
    if position($a$'entrega_pct', p.entrega_pct, 'activo', p.activo)$a$ in v_def) = 0 then raise exception 'Receta 137: planes_cuota_lista no tiene el patrón esperado'; end if;
    execute replace(v_def, $a$'entrega_pct', p.entrega_pct, 'activo', p.activo)$a$,
      $b$'entrega_pct', p.entrega_pct, 'recargo_pct', p.recargo_pct, 'activo', p.activo) -- 137: recargo$b$);
  end if;

  v_def := pg_get_functiondef('planes_cuota_guardar(jsonb)'::regprocedure);
  if position('-- 137: recargo' in v_def) = 0 then
    if position($a$v_orden := v_orden + 1;$a$ in v_def) = 0
       or position($a$returning id into v_id;$a$ in v_def) = 0
       or position($a$orden = v_orden, activo$a$ in v_def) = 0 then
      raise exception 'Receta 137: planes_cuota_guardar no tiene el patrón esperado';
    end if;
    v_def := replace(v_def, $a$v_orden := v_orden + 1;$a$,
      $b$if coalesce(nullif(x->>'recargo_pct', '')::numeric, 0) < 0 or coalesce(nullif(x->>'recargo_pct', '')::numeric, 0) > 300 then -- 137: recargo
      raise exception 'El recargo de "%" va de 0 a 300 %%', btrim(x->>'nombre');
    end if;
    v_orden := v_orden + 1;$b$);
    v_def := replace(v_def, $a$returning id into v_id;$a$,
      $b$returning id into v_id;
      update planes_cuota set recargo_pct = coalesce(nullif(x->>'recargo_pct', '')::numeric, 0) where id = v_id;$b$);
    v_def := replace(v_def, $a$orden = v_orden, activo$a$, $b$recargo_pct = coalesce(nullif(x->>'recargo_pct', '')::numeric, 0), orden = v_orden, activo$b$);
    execute v_def;
  end if;

  -- Vender con plan: el recargo entra antes de poner la entrega (las dos funciones tienen el mismo paso).
  foreach v_def in array array[pg_get_functiondef('vender_en_cuotas(jsonb)'::regprocedure),
                               pg_get_functiondef('crear_venta_cuotas(uuid,text,text,text,text,jsonb,text,numeric,integer,uuid,text,integer,text,numeric,jsonb,uuid)'::regprocedure)] loop
    if position('-- 137: recargo' in v_def) = 0 then
      if position($a$  if v_entrega > 0 then
    update ventas set entrega = v_entrega$a$ in v_def) = 0 then raise exception 'Receta 137: la venta en cuotas no tiene el patrón esperado'; end if;
      v_def := replace(v_def, $a$  if v_entrega > 0 then
    update ventas set entrega = v_entrega$a$, $b$  v_total := v_total + recargo_plan_cuotas(v_id, pl.id, v_entrega);  -- 137: recargo

  if v_entrega > 0 then
    update ventas set entrega = v_entrega$b$);
      v_def := replace(v_def, $a$'recibo_entrega', v_cobro->>'numero_recibo')$a$, $b$'recibo_entrega', v_cobro->>'numero_recibo', 'total', v_total)$b$);
      execute v_def;
    end if;
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
