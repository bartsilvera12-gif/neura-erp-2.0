-- =============================================================================
-- MENÚ FABRICABLE POR TANDA (168)
-- Pedido del dueño: un producto VENDIBLE (Menú) tiene que poder fabricarse a stock desde su
-- receta y venderse de ese stock (el viejo "Fabricado"). Hoy un Menú con receta descuenta sus
-- ingredientes al vender y no lleva stock. Se generaliza "por tanda" (que ya anda en materia
-- prima) a los Menú: si una receta de Menú se marca "Se fabrica por tanda", el producto lleva
-- stock propio, aparece en Fabricar (descuenta las materias primas, suma stock del Menú) y al
-- venderse descuenta su propio stock (no vuelve a explotar los ingredientes).
--   · receta_guardar: deja marcar por_tanda a un Menú y le prende controla_stock.
--   · tg_productos_tipo: un Menú por tanda conserva su stock (no lo fuerza a 0).
--   · fabricar_producto / fabricables: incluyen los Menú por tanda.
--   · crear_venta: la guarda "Menú sin receta" mira receta_existe() (no v_receta): el por tanda
--     tiene receta pero tiene_receta()=false, así cae solo en la rama de stock propio al vender.
--     Parche DINÁMICO sobre la función viva (16 params, 98/131) → no rompe cuotas ni planes.
-- necesidad_stock NO cambia: tiene_receta() ya excluye el por tanda, que así descuenta su propio stock.
-- Un Menú SIN "por tanda" sigue igual que siempre (descuenta ingredientes, sin stock).
-- create or replace preserva grants (no hace falta re-grantear). Va después de 97 y 160.
-- IDEMPOTENTE y atómica (begin/commit).
-- =============================================================================
\set ON_ERROR_STOP on
begin;
set search_path to :"schema", public;

-- ── receta_guardar (redefinida desde la 97) ──
create or replace function :"schema".receta_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  prod productos;
  ins productos;
  it jsonb;
  gj jsonb;
  oj jsonb;
  v_id uuid := nullif(p->>'producto_id', '')::uuid;
  v_rend numeric := coalesce(nullif(p->>'rendimiento', '')::numeric, 1);
  v_notas text := left(nullif(btrim(coalesce(p->>'notas', '')), ''), 1000);
  v_items jsonb := coalesce(p->'items', '[]'::jsonb);
  v_ins uuid;
  v_cant numeric;
  v_merma numeric;
  v_unidad text;
  v_vistos uuid[] := '{}';
  v_orden integer := 0;
  v_prof integer;
  v_tenia boolean;
  v_tanda_antes boolean;
  v_tanda boolean;
  v_ex uuid;
  v_max integer;
  v_pre numeric;
  v_gid uuid;
  v_oid uuid;
  v_gnom text;
  v_onom text;
  v_oblig boolean;
  v_min integer;
  v_gmax integer;
  v_gids uuid[] := '{}';
  v_oids uuid[];
  v_gnoms text[] := '{}';
  v_onoms text[];
  v_gorden integer := 0;
  v_oorden integer;
  v_nact integer;
  ij jsonb;
  v_iorden integer;
  v_ivistos uuid[];
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  perform exigir_permiso('editar_productos');
  if v_id is null then raise exception 'Falta el producto'; end if;
  select * into prod from productos where id = v_id and empresa_id = s.s_empresa for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if prod.tipo_producto not in ('menu', 'materia_prima', 'fabricado') then
    raise exception '"%" es de Reventa: llevan receta los productos Menú, los Fabricados y las materias primas (preparaciones)', prod.nombre;
  end if;
  if jsonb_typeof(v_items) <> 'array' then raise exception 'Ingredientes inválidos'; end if;
  if jsonb_array_length(v_items) > 60 then raise exception 'Son demasiados ingredientes (hasta 60)'; end if;
  if v_rend <= 0 or v_rend > 100000 then raise exception 'El rendimiento tiene que ser mayor a 0'; end if;
  if p ? 'por_tanda' and jsonb_typeof(p->'por_tanda') <> 'boolean' then raise exception '"por_tanda" debe ser sí o no'; end if;
  v_tenia := receta_existe(prod.id);
  v_tanda_antes := coalesce((select r.por_tanda from recetas r where r.producto_id = prod.id), false);
  v_tanda := case prod.tipo_producto
               when 'fabricado' then true
               when 'menu' then coalesce((p->>'por_tanda')::boolean, v_tanda_antes)
               else coalesce((p->>'por_tanda')::boolean, v_tanda_antes) end;

  -- Sin ingredientes: se quita la receta (una preparación vuelve a ser materia prima con stock).
  if jsonb_array_length(v_items) = 0 then
    delete from recetas where producto_id = prod.id;
    if prod.tipo_producto = 'materia_prima' and v_tenia and not v_tanda_antes then
      update productos set controla_stock = true, updated_at = now() where id = prod.id;
    end if;
    return receta_detalle(prod.id);
  end if;

  -- Preparación que se descuenta al vender: no lleva stock propio.
  if prod.tipo_producto = 'materia_prima' and not v_tanda and (not v_tenia or v_tanda_antes)
     and coalesce(prod.stock_actual, 0) <> 0 then
    raise exception '"%" tiene stock (%): una preparación que se descuenta al vender no lleva stock propio. Dejalo en 0 con un ajuste o elegí "Se fabrica por tanda".',
      prod.nombre, cant_texto(prod.stock_actual, prod.unidad_medida);
  end if;

  insert into recetas (producto_id, empresa_id, rendimiento, notas, updated_at, updated_por, por_tanda)
    values (prod.id, s.s_empresa, v_rend, v_notas, now(), s.s_usuario, v_tanda)
  on conflict (producto_id) do update set rendimiento = excluded.rendimiento, notas = excluded.notas,
    updated_at = now(), updated_por = excluded.updated_por, por_tanda = excluded.por_tanda;
  delete from recetas_items where producto_id = prod.id;

  for it in select * from jsonb_array_elements(v_items) loop
    v_orden := v_orden + 1;
    begin
      v_ins := (it->>'insumo_id')::uuid;
      v_cant := (it->>'cantidad')::numeric;
      v_merma := coalesce(nullif(it->>'merma_pct', '')::numeric, 0);
    exception when others then
      raise exception 'Ingrediente % inválido', v_orden;
    end;
    select * into ins from productos where id = v_ins and empresa_id = s.s_empresa;
    if not found then raise exception 'Ingrediente % no encontrado', v_orden; end if;
    if v_ins = any (v_vistos) then raise exception '"%" está dos veces: juntá las cantidades en una línea', ins.nombre; end if;
    v_vistos := v_vistos || v_ins;
    if v_cant is null or v_cant <= 0 then raise exception 'Cargá la cantidad de "%"', ins.nombre; end if;
    if v_merma < 0 or v_merma > 90 then raise exception 'La merma de "%" va de 0 a 90 %%', ins.nombre; end if;
    v_unidad := coalesce(unidad_normal(nullif(it->>'unidad', '')), ins.unidad_medida);
    insert into recetas_items (empresa_id, producto_id, insumo_id, cantidad, unidad, merma_pct, orden, se_puede_quitar)
      values (s.s_empresa, prod.id, v_ins, v_cant, v_unidad, v_merma, v_orden,
              prod.tipo_producto = 'menu' and coalesce((it->>'se_puede_quitar')::boolean, false));
  end loop;

  select greatest(max(receta_profundidad(a.pid)),
                  max((select max(receta_profundidad(oi.insumo_id) + 1) from plato_opcion_items oi where oi.insumo_id = a.pid)))
    into v_prof from (
    with recursive a(pid) as (
      select prod.id
      union
      select ri.producto_id from a join recetas_items ri on ri.insumo_id = a.pid
    ) select pid from a) a;
  if v_prof > 5 then
    raise exception 'Hay demasiadas preparaciones una dentro de otra (% niveles, máximo 5)', v_prof;
  end if;

  -- Extras del plato (solo Menú). Se reemplaza la lista entera.
  if prod.tipo_producto = 'menu' and p ? 'extras' then
    if jsonb_typeof(p->'extras') <> 'array' then raise exception 'Extras inválidos'; end if;
    if jsonb_array_length(p->'extras') > 40 then raise exception 'Son demasiados extras (hasta 40)'; end if;
    delete from plato_extras where producto_id = prod.id;
    v_orden := 0;
    v_vistos := '{}';
    for it in select * from jsonb_array_elements(p->'extras') loop
      v_orden := v_orden + 1;
      begin
        v_ex := (it->>'extra_id')::uuid;
        v_max := coalesce(nullif(it->>'maximo', '')::integer, 3);
        v_pre := nullif(it->>'precio', '')::numeric;
      exception when others then
        raise exception 'Extra % inválido', v_orden;
      end;
      if not exists (select 1 from extras where id = v_ex and empresa_id = s.s_empresa) then
        raise exception 'Extra % no encontrado', v_orden;
      end if;
      if v_ex = any (v_vistos) then raise exception 'Hay un extra repetido en el plato'; end if;
      v_vistos := v_vistos || v_ex;
      if v_max < 1 or v_max > 20 then raise exception 'El máximo de cada extra va de 1 a 20'; end if;
      if v_pre is not null and (v_pre < 0 or v_pre > 100000000) then raise exception 'El precio de un extra no es válido'; end if;
      insert into plato_extras (producto_id, extra_id, empresa_id, precio, maximo, orden)
        values (prod.id, v_ex, s.s_empresa, round(v_pre), v_max, v_orden);
    end loop;
  end if;

  -- Grupos de opciones (solo Menú). Se conservan los ids que vienen; los que faltan se borran.
  if prod.tipo_producto = 'menu' and p ? 'grupos' then
    if jsonb_typeof(p->'grupos') <> 'array' then raise exception 'Opciones inválidas'; end if;
    if jsonb_array_length(p->'grupos') > 12 then raise exception 'Son demasiados grupos de opciones (hasta 12)'; end if;
    for gj in select * from jsonb_array_elements(p->'grupos') loop
      v_gorden := v_gorden + 1;
      begin
        v_gid := nullif(gj->>'id', '')::uuid;
        v_oblig := coalesce((gj->>'obligatorio')::boolean, false);
        v_min := coalesce(nullif(gj->>'minimo', '')::integer, case when v_oblig then 1 else 0 end);
        v_gmax := coalesce(nullif(gj->>'maximo', '')::integer, 1);
      exception when others then
        raise exception 'Grupo de opciones % inválido', v_gorden;
      end;
      v_gnom := btrim(coalesce(gj->>'nombre', ''));
      if length(v_gnom) < 1 or length(v_gnom) > 60 then raise exception 'Escribí el nombre de cada grupo de opciones (hasta 60 letras)'; end if;
      if lower(v_gnom) = any (v_gnoms) then raise exception 'Hay dos grupos "%"', v_gnom; end if;
      v_gnoms := v_gnoms || lower(v_gnom);
      if jsonb_typeof(gj->'opciones') <> 'array' or jsonb_array_length(gj->'opciones') = 0 then
        raise exception 'El grupo "%" no tiene opciones', v_gnom;
      end if;
      if jsonb_array_length(gj->'opciones') > 20 then raise exception 'El grupo "%" tiene demasiadas opciones (hasta 20)', v_gnom; end if;
      select count(*) into v_nact from jsonb_array_elements(gj->'opciones') o where coalesce((o->>'activo')::boolean, true);
      v_min := case when v_oblig then greatest(v_min, 1) else 0 end;
      if v_gmax < 1 or v_gmax > 20 then raise exception 'En "%" el máximo va de 1 a 20', v_gnom; end if;
      if v_min > v_gmax then raise exception 'En "%" el mínimo no puede pasar el máximo', v_gnom; end if;
      if v_oblig and v_nact < v_min then raise exception 'El grupo obligatorio "%" necesita al menos % opción(es) activas', v_gnom, v_min; end if;
      v_gmax := least(v_gmax, greatest(v_nact, 1));
      if v_gid is not null and exists (select 1 from plato_opcion_grupos where id = v_gid and producto_id = prod.id) then
        update plato_opcion_grupos set nombre = v_gnom, obligatorio = v_oblig, minimo = least(v_min, v_gmax), maximo = v_gmax, orden = v_gorden
         where id = v_gid;
      else
        insert into plato_opcion_grupos (empresa_id, producto_id, nombre, obligatorio, minimo, maximo, orden)
          values (s.s_empresa, prod.id, v_gnom, v_oblig, least(v_min, v_gmax), v_gmax, v_gorden)
          returning id into v_gid;
      end if;
      v_gids := v_gids || v_gid;
      v_oids := '{}';
      v_onoms := '{}';
      v_oorden := 0;
      for oj in select * from jsonb_array_elements(gj->'opciones') loop
        v_oorden := v_oorden + 1;
        begin
          v_oid := nullif(oj->>'id', '')::uuid;
          v_pre := coalesce(nullif(oj->>'precio', '')::numeric, 0);
        exception when others then
          raise exception 'Opción % de "%" inválida', v_oorden, v_gnom;
        end;
        v_onom := btrim(coalesce(oj->>'nombre', ''));
        if length(v_onom) < 1 or length(v_onom) > 60 then raise exception 'Escribí el nombre de cada opción de "%"', v_gnom; end if;
        if lower(v_onom) = any (v_onoms) then raise exception 'En "%" hay dos opciones "%"', v_gnom, v_onom; end if;
        v_onoms := v_onoms || lower(v_onom);
        if v_pre < 0 or v_pre > 100000000 then raise exception 'El precio de "%" no es válido', v_onom; end if;
        if v_oid is not null and exists (select 1 from plato_opciones where id = v_oid and grupo_id = v_gid) then
          update plato_opciones set nombre = v_onom, precio = round(v_pre), activo = coalesce((oj->>'activo')::boolean, true), orden = v_oorden
           where id = v_oid;
        else
          insert into plato_opciones (empresa_id, grupo_id, nombre, precio, activo, orden)
            values (s.s_empresa, v_gid, v_onom, round(v_pre), coalesce((oj->>'activo')::boolean, true), v_oorden)
            returning id into v_oid;
        end if;
        v_oids := v_oids || v_oid;

        if oj ? 'items' then
          if jsonb_typeof(oj->'items') <> 'array' then raise exception 'Ingredientes de "%" inválidos', v_onom; end if;
          if jsonb_array_length(oj->'items') > 20 then raise exception '"%" tiene demasiados ingredientes (hasta 20)', v_onom; end if;
          delete from plato_opcion_items where opcion_id = v_oid;
          v_iorden := 0;
          v_ivistos := '{}';
          for ij in select * from jsonb_array_elements(oj->'items') loop
            v_iorden := v_iorden + 1;
            begin
              v_ins := (ij->>'insumo_id')::uuid;
              v_cant := (ij->>'cantidad')::numeric;
              v_merma := coalesce(nullif(ij->>'merma_pct', '')::numeric, 0);
            exception when others then
              raise exception 'Ingrediente % de "%" inválido', v_iorden, v_onom;
            end;
            select * into ins from productos where id = v_ins and empresa_id = s.s_empresa;
            if not found then raise exception 'Ingrediente % de "%" no encontrado', v_iorden, v_onom; end if;
            if v_ins = any (v_ivistos) then raise exception 'En "%" "%" está dos veces: juntá las cantidades', v_onom, ins.nombre; end if;
            v_ivistos := v_ivistos || v_ins;
            if v_cant is null or v_cant <= 0 then raise exception 'Cargá la cantidad de "%" en "%"', ins.nombre, v_onom; end if;
            if v_merma < 0 or v_merma > 90 then raise exception 'La merma de "%" en "%" va de 0 a 90 %%', ins.nombre, v_onom; end if;
            v_unidad := coalesce(unidad_normal(nullif(ij->>'unidad', '')), ins.unidad_medida);
            insert into plato_opcion_items (empresa_id, opcion_id, insumo_id, cantidad, unidad, merma_pct, orden)
              values (s.s_empresa, v_oid, v_ins, v_cant, v_unidad, v_merma, v_iorden);
          end loop;
        end if;
      end loop;
      delete from plato_opciones where grupo_id = v_gid and not (id = any (v_oids));
    end loop;
    delete from plato_opcion_grupos where producto_id = prod.id and not (id = any (v_gids));
  end if;

  -- Banderas y costo. Por tanda: tiene stock propio y su costo es el de lo fabricado (si ya hay
  -- stock no se toca; sin stock queda el de la receta como referencia). Al vender: sin stock y
  -- costo = el de su receta.
  update productos
     set controla_stock = case when tipo_producto in ('materia_prima', 'menu') then v_tanda
                               when tipo_producto = 'fabricado' then true else controla_stock end,
         controla_lotes = case when tipo_producto in ('materia_prima', 'menu') and not v_tanda then false else controla_lotes end,
         costo_promedio = case when v_tanda and coalesce(stock_actual, 0) > 0 then costo_promedio
                               else round(receta_costo(id)) end,
         updated_at = now()
   where id = prod.id;
  return receta_detalle(prod.id);
end;
$fn$;

-- ── tg_productos_tipo (redefinida desde la 97) ──
create or replace function :"schema".tg_productos_tipo()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_u text;
  v_rec boolean := tg_op = 'UPDATE' and exists (select 1 from recetas_items where producto_id = new.id);
  v_tanda boolean := tg_op = 'UPDATE' and exists (select 1 from recetas where producto_id = new.id and por_tanda);
  v_usos integer;
begin
  if new.tipo_producto = 'menu' then
    if v_tanda then
      new.controla_stock := true;  -- Menú que se fabrica por tanda: lleva stock propio.
    else
      if coalesce(new.stock_actual, 0) <> 0 then
        raise exception '"%" tiene stock (%): un producto Menú que se descuenta al vender no lleva stock propio. Dejá el stock en 0 con un ajuste, o en su receta elegí "Se fabrica por tanda".',
          new.nombre, trim_scale(new.stock_actual);
      end if;
      new.controla_stock := false;
      new.controla_lotes := false;
    end if;
  elsif new.tipo_producto = 'materia_prima' then
    new.es_vendible := false;
    new.en_menu_qr := false;
    new.estacion_id := null;
    v_u := unidad_normal(new.unidad_medida);
    if v_u is null then
      raise exception 'La unidad "%" no sirve para una materia prima: elegí Unidad, kg, g, l o ml', new.unidad_medida;
    end if;
    new.unidad_medida := v_u;
    if v_rec and not v_tanda then
      -- Preparación que se descuenta al vender: sin stock propio, se explota.
      new.controla_stock := false;
      new.controla_lotes := false;
    end if;
  elsif new.tipo_producto = 'fabricado' then
    new.controla_stock := true;
    v_u := unidad_normal(new.unidad_medida);
    if v_u is not null then new.unidad_medida := v_u; end if;
    -- Viene de Menú o de una preparación que se descuenta al vender: pasa a fabricarse por tanda.
    if v_rec and not v_tanda then update recetas set por_tanda = true where producto_id = new.id; end if;
  elsif v_rec then
    raise exception '"%" tiene receta: quitala en Inventario › Recetas antes de pasarlo a Reventa', new.nombre;
  end if;

  if tg_op = 'UPDATE' then
    select (select count(*) from recetas_items where insumo_id = new.id)
         + (select count(distinct o.grupo_id) from plato_opcion_items oi join plato_opciones o on o.id = oi.opcion_id where oi.insumo_id = new.id)
      into v_usos;
    if v_usos > 0 and new.tipo_producto not in ('materia_prima', 'fabricado') then
      raise exception '"%" es ingrediente de % receta(s) u opciones de platos: sacalo de ahí antes de cambiarle el tipo', new.nombre, v_usos;
    end if;
    if v_usos > 0 and unidad_dim(new.unidad_medida) is distinct from unidad_dim(old.unidad_medida) then
      raise exception '"%" es ingrediente de % receta(s) u opciones de platos en %: no se puede pasar a % (otra magnitud)',
        new.nombre, v_usos, old.unidad_medida, new.unidad_medida;
    end if;
  end if;
  return new;
end;
$fn$;

-- ── fabricar_producto (redefinida desde la 97) ──
create or replace function :"schema".fabricar_producto(p_empresa uuid, p_producto uuid, p_bloquear boolean default false)
returns :"schema".productos
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  prod productos;
begin
  if p_producto is null then raise exception 'Elegí qué producto fabricar'; end if;
  if p_bloquear then
    select * into prod from productos where id = p_producto and empresa_id = p_empresa for update;
  else
    select * into prod from productos where id = p_producto and empresa_id = p_empresa;
  end if;
  if not found then raise exception 'Producto no encontrado'; end if;
  if not prod.activo then raise exception '"%" está inactivo', prod.nombre; end if;
  if prod.tipo_producto not in ('fabricado', 'materia_prima', 'menu') then
    raise exception '"%" no se fabrica: solo los productos Menú o preparaciones con receta marcada "Se fabrica por tanda"', prod.nombre;
  end if;
  if not receta_existe(prod.id) then
    raise exception '"%" no tiene receta: cargala en Inventario › Recetas para poder fabricarlo', prod.nombre;
  end if;
  if not receta_por_tanda(prod.id) then
    raise exception '"%" se descuenta al vender: en su receta elegí "Se fabrica por tanda" para fabricarlo', prod.nombre;
  end if;
  return prod;
end;
$fn$;

-- ── fabricables (redefinida desde la 97) ──
create or replace function :"schema".fabricables(p_deposito uuid default null)
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_dep uuid;
begin
  select * into s from inv_sesion(array['ADMIN', 'CAJERO', 'VENDEDOR', 'SUPERVISOR']);
  perform exigir_permiso('fabricar');
  v_dep := coalesce(p_deposito, deposito_por_defecto(s.s_empresa, s.s_sucursal));
  return jsonb_build_object('deposito_id', v_dep, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'nombre', p.nombre, 'sku', p.sku, 'tipo_producto', p.tipo_producto, 'unidad_medida', p.unidad_medida,
      'rendimiento', r.rendimiento, 'controla_lotes', p.controla_lotes, 'imagen_url', p.imagen_url,
      'stock', coalesce((select sd.cantidad from stock_depositos sd where sd.producto_id = p.id and sd.deposito_id = v_dep), 0),
      'alcanza', fabricar_alcanza(p.id, v_dep, mesa_reservas_json((select d.sucursal_id from depositos d where d.id = v_dep))))
      order by (p.tipo_producto <> 'fabricado'), p.nombre)
      from productos p join recetas r on r.producto_id = p.id and r.por_tanda
     where p.empresa_id = s.s_empresa and p.activo and p.tipo_producto in ('fabricado', 'materia_prima', 'menu')
       and exists (select 1 from recetas_items ri where ri.producto_id = p.id)), '[]'::jsonb));
end;
$fn$;

-- ── crear_venta (parche dinámico sobre la viva, 16 params): el Menú por tanda se vende de su propio stock ──
-- Overload viejo de 14 params (sin cuotas): no debe existir junto al de 98. Se borra por las dudas.
drop function if exists :"schema".crear_venta(uuid,text,text,text,text,jsonb,jsonb,text,numeric,integer,uuid,uuid,text,boolean);
do $patch168$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = current_schema()::regnamespace
     and p.proname = 'crear_venta'
     and pg_get_function_identity_arguments(p.oid) like '%p_cuotas%';
  if v_def is null then raise exception 'Parche 168: no existe crear_venta(...p_cuotas...)'; end if;

  -- Un Menú necesita receta para venderse, EN CUALQUIER MODO. tiene_receta() excluye las "por tanda"
  -- (son stock propio, no se explotan), así que la guarda tiene que mirar receta_existe(), no v_receta:
  -- si no, un Menú por tanda (tiene_receta = false) se rechaza como "sin receta" aunque sí la tenga.
  -- No se toca v_receta: ya vale false para el por tanda → la venta cae en la rama de stock propio.
  v_new := replace(v_def, 'if prod.tipo_producto = ''menu'' and not v_receta then',
                          'if prod.tipo_producto = ''menu'' and not receta_existe(prod.id) then');
  if v_new = v_def then raise exception 'Parche 168: crear_venta sin la guarda de Menú esperada'; end if;

  execute v_new;  -- create or replace: conserva grants y la firma de 16 params.
end;
$patch168$;

commit;

notify pgrst, 'reload schema';
