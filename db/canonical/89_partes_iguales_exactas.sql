-- =============================================================================
-- 89 · Cuenta separada en partes iguales: montos parejos y suma exacta.
--   Antes (88) cada producto se dividía en milésimos y cada línea se redondeaba por su lado:
--   Gs. 30.500 entre 3 daba 10.163 / 10.166 / 10.172 (suma 30.501).
--   Ahora el importe de cada producto se reparte en guaraníes enteros entre las personas (el
--   guaraní que sobra va a quien va más abajo de su parte justa) y la cantidad de cada parte se
--   calcula para dar justo ese importe (6 decimales): 10.167 / 10.167 / 10.166, suma 30.500.
-- IDEMPOTENTE (el parche no se aplica dos veces).
-- =============================================================================

set search_path to :"schema", public;

-- Cantidades con 6 decimales (ventas_items.cantidad ya es numeric sin escala).
do $$
begin
  if (select numeric_scale from information_schema.columns
       where table_schema = current_schema() and table_name = 'mesa_cuenta_parte_items' and column_name = 'cantidad') is distinct from 6 then
    alter table mesa_cuenta_parte_items alter column cantidad type numeric(18, 6);
  end if;
end $$;

-- Reparto en partes iguales (lo llama mesa_publico_dividir).
create or replace function :"schema".mesa_repartir_iguales(p_empresa uuid, p_cuenta uuid, p_partes uuid[])
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_n integer := cardinality(p_partes);
  v_total numeric;
  v_obj numeric[];      -- lo justo de cada persona (guaraníes enteros, suma = total)
  v_lleva numeric[];    -- lo que ya lleva cada una
  it record;
  v_base numeric;
  v_rem integer;
  v_monto numeric[];
  v_cant numeric[];
  v_suma numeric;
  v_mayor integer;
  k integer;
  j integer;
begin
  if v_n < 2 then return; end if;
  select coalesce(sum(round(s.cantidad * i.precio_unitario)), 0) into v_total
    from mesa_seleccion(p_cuenta, null, false) s join mesa_pedido_items i on i.id = s.item_id;
  v_obj := array_fill(0::numeric, array[v_n]);
  v_lleva := array_fill(0::numeric, array[v_n]);
  for k in 1..v_n loop
    v_obj[k] := floor(v_total / v_n) + case when k <= (v_total - floor(v_total / v_n) * v_n) then 1 else 0 end;
  end loop;

  for it in
    select s.item_id, s.cantidad, i.precio_unitario as precio, round(s.cantidad * i.precio_unitario) as importe
      from mesa_seleccion(p_cuenta, null, false) s join mesa_pedido_items i on i.id = s.item_id
     order by round(s.cantidad * i.precio_unitario) desc, s.item_id
  loop
    v_base := floor(it.importe / v_n);
    v_rem := (it.importe - v_base * v_n)::integer;
    v_monto := array_fill(v_base, array[v_n]);
    -- Los guaraníes que sobran: a quien más lejos está de su parte justa.
    for j in 1..v_rem loop
      select x.k into k from generate_subscripts(v_obj, 1) x(k)
       where v_monto[x.k] = v_base
       order by v_obj[x.k] - v_lleva[x.k] - v_monto[x.k] desc, x.k limit 1;
      v_monto[k] := v_monto[k] + 1;
    end loop;
    -- Cantidad de cada parte para ese importe; la más grande absorbe el ajuste fino de la cantidad.
    v_cant := array_fill(0::numeric, array[v_n]);
    v_suma := 0;
    v_mayor := 1;
    for k in 1..v_n loop
      v_cant[k] := case when it.importe > 0 then round(v_monto[k] * it.cantidad / it.importe, 6)
                        else round(it.cantidad / v_n, 6) end;
      v_suma := v_suma + v_cant[k];
      if v_cant[k] > v_cant[v_mayor] then v_mayor := k; end if;
    end loop;
    v_cant[v_mayor] := v_cant[v_mayor] + (it.cantidad - v_suma);
    for k in 1..v_n loop
      v_lleva[k] := v_lleva[k] + v_monto[k];
      if v_cant[k] > 0 then
        insert into mesa_cuenta_parte_items (empresa_id, parte_id, item_id, cantidad)
          values (p_empresa, p_partes[k], it.item_id, v_cant[k]);
      end if;
    end loop;
  end loop;
end;
$fn$;
revoke all on function :"schema".mesa_repartir_iguales(uuid, uuid, uuid[]) from public, anon, authenticated;

-- mesa_publico_dividir (88): el bloque de partes iguales pasa a usar mesa_repartir_iguales.
do $patch$
declare
  r record;
  v_def text;
  v_new text;
  v_ini integer;
  v_fin integer;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = current_schema() and p.proname = 'mesa_publico_dividir'
  loop
    v_def := pg_get_functiondef(r.oid);
    continue when strpos(v_def, 'mesa_repartir_iguales(') > 0;
    v_ini := strpos(v_def, '    -- Cada ítem se reparte en N partes con 3 decimales');
    v_fin := strpos(v_def, '      v_idx := v_idx + v_rem;');
    if v_ini = 0 or v_fin = 0 then raise exception '89: no se encontró el reparto de partes iguales en mesa_publico_dividir'; end if;
    v_fin := v_fin + length('      v_idx := v_idx + v_rem;') + 1;
    v_fin := strpos(substr(v_def, v_fin), 'end loop;') + v_fin - 1 + length('end loop;');
    v_new := left(v_def, v_ini - 1)
          || '    -- 89: importe de cada producto repartido en guaraníes enteros (partes parejas, suma exacta).' || chr(10)
          || '    perform mesa_repartir_iguales(c.empresa_id, c.id, v_ids);'
          || substr(v_def, v_fin);
    execute v_new;
  end loop;
end
$patch$;
