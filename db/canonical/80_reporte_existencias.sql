-- =============================================================================
-- REPORTE "EXISTENCIAS POR DEPÓSITO" — pedido del dueño, 27-oct-2026.
--
-- Foto de HOY del stock: una fila por producto y una columna por depósito activo (agrupados
-- por sucursal), con Total y Valor del stock. Sin fechas.
--
--   reporte_existencias(p_sucursal, p_deposito, p_categoria, p_tipo, p_solo_stock, p_bajo_minimo)
--     → { generado, ver_costos, recetas, sucursal_id, sucursales[], depositos[] (columnas),
--         opciones_depositos[] (filtro), items[] }
--     items: { id, nombre, sku, codigo_barras, unidad_medida, categoria, tipo_producto,
--              controla_lotes, stock_minimo, imagen_url, total, valor,
--              c: { deposito_id: cantidad }, v: { deposito_id: valor } }
--   reporte_existencias_celda(p_producto, p_deposito)
--     → { producto, deposito, sucursal, cantidad, valor, ver_costos, controla_lotes, unidad_medida,
--         stock_minimo, capas[] (capas de costo vigentes de ESE depósito), lotes[] }
--
-- Reglas:
--   · Productos: activos, que controlan stock (Reventa y Materia prima; los platos de Menú no
--     tienen stock y quedan afuera). p_tipo ('reventa' | 'materia_prima') solo se aplica si la
--     función Recetas está activa.
--   · Sucursal: con alcance "todas" se elige (o todas); si no, queda fija en la del usuario.
--   · Total = suma de los depósitos que se muestran (filtrados por sucursal / depósito).
--     "Bajo el mínimo" = stock_minimo > 0 y Total < stock_minimo. "Solo con stock" = Total ≠ 0.
--   · Valor = capas_valor() (receta 79): Σ capas vigentes × su costo + lotes × su costo; lo
--     que las capas no explican (o un producto sin capas) va al costo promedio × cantidad.
--     Solo con permiso "ver costos" (sin él, valor = null y no se calcula).
--   · Detalle de capas: capas_producto() (receta 79) filtrado al depósito (pide "ver costos").
--     Los lotes con su vencimiento se muestran siempre (costo solo con "ver costos").
-- SECURITY INVOKER + empresa_actual() (RLS de la sesión). IDEMPOTENTE. Va después de 79.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create or replace function :"schema".reporte_existencias(
  p_sucursal uuid default null, p_deposito uuid default null, p_categoria text default null,
  p_tipo text default null, p_solo_stock boolean default true, p_bajo_minimo boolean default false
) returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_costos boolean;
  v_recetas boolean;
  v_todas boolean;
  v_suc uuid := p_sucursal;
  v_tipo text;
  r jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  if not (tiene_permiso('ver_reportes_financieros')) then perform exigir_permiso('ver_reportes_financieros'); end if;
  v_costos := tiene_permiso('ver_costos');
  v_recetas := coalesce((funciones_empresa() ->> 'recetas')::boolean, false);
  v_tipo := case when v_recetas and p_tipo in ('reventa', 'materia_prima') then p_tipo end;
  v_todas := alcance_todas();
  if not v_todas then
    v_suc := coalesce((select s.p_sucursal from perfil_sesion() s), sucursal_principal(v_emp));
  elsif v_suc is not null and not exists (select 1 from sucursales where id = v_suc and empresa_id = v_emp) then
    raise exception 'Sucursal no encontrada';
  end if;

  with deps_suc as (
    select d.id, d.nombre, d.sucursal_id, s.nombre as sucursal, d.es_principal,
           row_number() over (order by s.es_principal desc, s.nombre, d.es_principal desc, d.nombre) as orden
      from depositos d join sucursales s on s.id = d.sucursal_id
     where d.empresa_id = v_emp and d.activo
       and (v_suc is null or d.sucursal_id = v_suc)
  ),
  deps as (
    select * from deps_suc where p_deposito is null or id = p_deposito
  ),
  prods as (
    select p.id, p.nombre, p.sku, p.codigo_barras, p.unidad_medida, p.tipo_producto, p.imagen_url,
           coalesce(p.controla_lotes, false) as controla_lotes, coalesce(p.stock_minimo, 0) as stock_minimo,
           coalesce(p.costo_promedio, 0) as cp,
           case when pa.id is null then c.nombre else pa.nombre || ' › ' || c.nombre end as categoria
      from productos p
      left join categorias_productos c on c.id = p.categoria_principal_id
      left join categorias_productos pa on pa.id = c.parent_id
     where p.empresa_id = v_emp and p.activo and p.controla_stock
       and coalesce(p.tipo_producto, 'reventa') <> 'menu'
       and (v_tipo is null or p.tipo_producto = v_tipo)
       and (p_categoria is null
            or (p_categoria = '__sin__' and p.categoria_principal_id is null)
            or (p.categoria_principal_id is not null and (p.categoria_principal_id::text = p_categoria or c.parent_id::text = p_categoria)))
  ),
  celdas as (
    select sd.producto_id, sd.deposito_id, sd.cantidad,
           case when v_costos then round(capas_valor(sd.producto_id, sd.deposito_id, sd.cantidad, pr.cp)) end as valor
      from stock_depositos sd
      join deps d on d.id = sd.deposito_id
      join prods pr on pr.id = sd.producto_id
     where sd.cantidad <> 0
  ),
  filas as (
    select pr.*, coalesce(sum(ce.cantidad), 0) as total,
           case when v_costos then coalesce(sum(ce.valor), 0) end as valor,
           coalesce(jsonb_object_agg(ce.deposito_id, ce.cantidad) filter (where ce.deposito_id is not null), '{}'::jsonb) as c,
           case when v_costos then coalesce(jsonb_object_agg(ce.deposito_id, ce.valor) filter (where ce.deposito_id is not null), '{}'::jsonb) end as v
      from prods pr left join celdas ce on ce.producto_id = pr.id
     group by pr.id, pr.nombre, pr.sku, pr.codigo_barras, pr.unidad_medida, pr.tipo_producto, pr.imagen_url,
              pr.controla_lotes, pr.stock_minimo, pr.cp, pr.categoria
  )
  select jsonb_build_object(
    'generado', to_char(now() at time zone 'America/Asuncion', 'YYYY-MM-DD"T"HH24:MI'),
    'ver_costos', v_costos,
    'recetas', v_recetas,
    'sucursal_id', v_suc,
    'sucursales', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'es_principal', s.es_principal)
                                             order by s.es_principal desc, s.nombre)
                              from sucursales s where s.empresa_id = v_emp and (s.activa or s.id = v_suc)
                               and (v_todas or s.id = v_suc)), '[]'::jsonb),
    'opciones_depositos', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nombre', d.nombre, 'sucursal', d.sucursal) order by d.orden)
                                      from deps_suc d), '[]'::jsonb),
    'depositos', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nombre', d.nombre, 'sucursal_id', d.sucursal_id,
                                                               'sucursal', d.sucursal, 'es_principal', d.es_principal) order by d.orden)
                             from deps d), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', f.id, 'nombre', f.nombre, 'sku', f.sku, 'codigo_barras', f.codigo_barras,
                         'unidad_medida', f.unidad_medida, 'categoria', f.categoria, 'tipo_producto', f.tipo_producto,
                         'controla_lotes', f.controla_lotes, 'stock_minimo', f.stock_minimo, 'imagen_url', f.imagen_url,
                         'total', f.total, 'valor', f.valor, 'c', f.c, 'v', f.v) order by f.nombre)
                         from filas f
                        where (not coalesce(p_solo_stock, true) or f.total <> 0)
                          and (not coalesce(p_bajo_minimo, false) or (f.stock_minimo > 0 and f.total < f.stock_minimo))), '[]'::jsonb)
  ) into r;
  return r;
end;
$fn$;
revoke all on function :"schema".reporte_existencias(uuid, uuid, text, text, boolean, boolean) from public, anon;
grant execute on function :"schema".reporte_existencias(uuid, uuid, text, text, boolean, boolean) to authenticated, service_role;

-- Detalle de una celda (producto + depósito): cantidad, valor, capas vigentes y lotes.
create or replace function :"schema".reporte_existencias_celda(p_producto uuid, p_deposito uuid)
returns jsonb
language plpgsql stable security invoker set search_path = :"schema", public as $fn$
declare
  v_emp uuid := empresa_actual();
  v_costos boolean;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  pr record;
  dp record;
  v_cant numeric;
  v_capas jsonb := '[]'::jsonb;
begin
  if v_emp is null then raise exception 'No hay empresa en la sesión'; end if;
  if not (tiene_permiso('ver_reportes_financieros')) then perform exigir_permiso('ver_reportes_financieros'); end if;
  v_costos := tiene_permiso('ver_costos');
  select p.id, p.nombre, p.sku, p.unidad_medida, coalesce(p.stock_minimo, 0) as stock_minimo,
         coalesce(p.costo_promedio, 0) as cp, coalesce(p.controla_lotes, false) and p.controla_stock as con_lotes
    into pr from productos p where p.id = p_producto and p.empresa_id = v_emp;
  if not found then raise exception 'Producto no encontrado'; end if;
  select d.id, d.nombre, s.nombre as sucursal into dp
    from depositos d join sucursales s on s.id = d.sucursal_id
   where d.id = p_deposito and d.empresa_id = v_emp;
  if not found then raise exception 'Depósito no encontrado'; end if;
  if not alcance_todas() and dp.id not in (
       select d.id from depositos d where d.sucursal_id = coalesce((select s.p_sucursal from perfil_sesion() s), sucursal_principal(v_emp))) then
    raise exception 'Depósito no encontrado';
  end if;
  v_cant := coalesce((select sd.cantidad from stock_depositos sd where sd.producto_id = pr.id and sd.deposito_id = dp.id), 0);
  if v_costos then
    select coalesce(jsonb_agg(x order by (x ->> 'orden')::int nulls last), '[]'::jsonb) into v_capas
      from jsonb_array_elements(capas_producto(pr.id, false) -> 'capas') x
     where x ->> 'deposito_id' = dp.id::text and x ->> 'tipo' = 'capa' and (x ->> 'quedan')::numeric > 0;
  end if;
  return jsonb_build_object(
    'producto', jsonb_build_object('id', pr.id, 'nombre', pr.nombre, 'sku', pr.sku),
    'deposito', jsonb_build_object('id', dp.id, 'nombre', dp.nombre, 'sucursal', dp.sucursal),
    'cantidad', v_cant,
    'valor', case when v_costos then round(capas_valor(pr.id, dp.id, v_cant, pr.cp)) end,
    'costo_promedio', case when v_costos then pr.cp end,
    'ver_costos', v_costos,
    'controla_lotes', pr.con_lotes,
    'unidad_medida', pr.unidad_medida,
    'stock_minimo', pr.stock_minimo,
    'hoy', v_hoy,
    'capas', v_capas,
    'lotes', case when pr.con_lotes then coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', l.id, 'numero', l.numero, 'vencimiento', l.vencimiento, 'vencido', l.vencimiento < v_hoy,
                 'dias', l.vencimiento - v_hoy, 'cantidad', l.cantidad,
                 'costo_unitario', case when v_costos then coalesce(nullif(l.costo_unitario, 0), pr.cp) end,
                 'valor', case when v_costos then round(l.cantidad * coalesce(nullif(l.costo_unitario, 0), pr.cp)) end)
               order by l.vencimiento, l.created_at)
          from lotes l where l.producto_id = pr.id and l.deposito_id = dp.id and l.cantidad > 0), '[]'::jsonb)
      else '[]'::jsonb end
  );
end;
$fn$;
revoke all on function :"schema".reporte_existencias_celda(uuid, uuid) from public, anon;
grant execute on function :"schema".reporte_existencias_celda(uuid, uuid) to authenticated, service_role;

commit;
