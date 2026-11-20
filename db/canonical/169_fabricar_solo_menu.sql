-- =============================================================================
-- FABRICAR SOLO MENÚ (169) — pedido del dueño (2026-11-20)
-- Se deshabilita, por ahora, la fabricación de materias primas (preparaciones "por tanda"):
-- Fabricar queda SOLO para los productos Menú marcados "Se fabrica por tanda".
--   · fabricar_producto: rechaza todo lo que no sea Menú.
--   · fabricables: la lista del diálogo Fabricar solo trae Menú por tanda (ya no las preparaciones).
-- El resto del flujo (consumo con merma, PEPS, stock del Menú) no cambia. create or replace
-- preserva grants. Va después de 168. IDEMPOTENTE y atómica.
-- =============================================================================
\set ON_ERROR_STOP on
begin;
set search_path to :"schema", public;

-- ── fabricar_producto: solo Menú ──
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
  if prod.tipo_producto <> 'menu' then
    raise exception '"%" no se fabrica: solo los productos Menú con receta marcada "Se fabrica por tanda"', prod.nombre;
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

-- ── fabricables: la lista del diálogo Fabricar solo trae Menú por tanda ──
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
      order by p.nombre)
      from productos p join recetas r on r.producto_id = p.id and r.por_tanda
     where p.empresa_id = s.s_empresa and p.activo and p.tipo_producto = 'menu'
       and exists (select 1 from recetas_items ri where ri.producto_id = p.id)), '[]'::jsonb));
end;
$fn$;

commit;

notify pgrst, 'reload schema';
