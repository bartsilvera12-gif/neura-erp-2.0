-- =============================================================================
-- PRESUPUESTOS: EL PRECIO SALE DEL INVENTARIO (pedido del socio del dueño, 30-oct-2026).
--
-- El precio de una línea no se edita: es el de lista del producto. Si hace falta bajar el precio,
-- se usa el descuento. Lo cotizado se respeta: al editar un presupuesto, una línea que ya tenía ese
-- producto a ese precio lo conserva aunque la lista haya cambiado después. Cualquier otro precio
-- que llegue se reemplaza por el de lista.
--
-- IDEMPOTENTE. Va después de 106.
-- =============================================================================

begin;
set local search_path to :"schema", public;

do $do$
declare
  c record;
  v_def text;
begin
  for c in select * from (values
    ($a$  v_precio numeric;$a$, $b$  v_precio numeric;
  v_previos jsonb;   -- 107: lo cotizado antes de esta edición$b$),
    ($a$    delete from presupuestos_items where presupuesto_id = v_id;$a$,
     $b$    select coalesce(jsonb_agg(jsonb_build_object('p', i.producto_id, 'v', i.precio_unitario)), '[]'::jsonb) into v_previos
      from presupuestos_items i where i.presupuesto_id = v_id;
    delete from presupuestos_items where presupuesto_id = v_id;$b$),
    ($a$    if not prod.activo then raise exception 'Línea %: el producto "%" está inactivo', v_orden, prod.nombre; end if;$a$,
     $b$    if not prod.activo then raise exception 'Línea %: el producto "%" está inactivo', v_orden, prod.nombre; end if;
    -- 107: el precio es el de lista, salvo que ya estuviera cotizado así.
    if not coalesce(v_previos, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('p', prod.id, 'v', v_precio)) then
      v_precio := round(prod.precio_venta / v_cambio, v_dec);
      if v_precio is null or v_precio <= 0 then
        raise exception 'Línea %: "%" no tiene precio: cargalo en el inventario', v_orden, prod.nombre;
      end if;
    end if;$b$)
  ) x(patron, nuevo)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = 'guardar_presupuesto';
    if position(c.nuevo in v_def) > 0 then continue; end if;   -- ya aplicado
    if position(c.patron in v_def) = 0 then raise exception 'Parche 107: guardar_presupuesto no tiene el patrón esperado (%)', left(c.patron, 60); end if;
    execute replace(v_def, c.patron, c.nuevo);
  end loop;
end;
$do$;

commit;
