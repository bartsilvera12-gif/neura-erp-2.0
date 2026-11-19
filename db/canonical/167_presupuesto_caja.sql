-- =============================================================================
-- PRESUPUESTOS POR COBRAR EN LA CAJA (167)
-- El vendedor arma el presupuesto y lo "envía a la caja" (no se lo redirige: para eso está
-- el cajero). "Enviar a la caja" reutiliza presupuesto_cambiar_estado('aceptar') → estado
-- 'aceptado'. Acá se listan los 'aceptado' (listos para cobrar), para la bandeja de
-- Caja › Nueva venta (como "Pedidos por cobrar" / "Mesas por cobrar"). El cajero lo toca y
-- carga sus líneas (?presupuesto=<id>, igual que antes). El vendedor no ve la bandeja.
-- Va después de 53 (presupuestos) y 51 (caja).
-- =============================================================================
\set ON_ERROR_STOP on
set search_path to :"schema", public;

create or replace function :"schema".presupuestos_por_cobrar()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare s record;
begin
  select * into s from inv_sesion(array['ADMIN', 'SUPERVISOR', 'CAJERO', 'VENDEDOR']);
  -- El vendedor arma y envía; cobra la caja (no ve la bandeja).
  if s.s_rol = 'VENDEDOR' then
    return jsonb_build_object('ahora', now(), 'presupuestos', '[]'::jsonb);
  end if;
  return jsonb_build_object('ahora', now(), 'presupuestos', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'numero', p.numero, 'revision', p.revision,
      'cliente', coalesce(nullif(c.razon_social, ''), nullif(c.nombre, ''), p.cliente_nombre),
      'total', p.total, 'moneda', p.moneda, 'condicion', p.condicion,
      'items', (select count(*) from presupuestos_items pi where pi.presupuesto_id = p.id),
      'aceptado_at', p.aceptado_at, 'valido_hasta', p.valido_hasta,
      'vencido', (p.valido_hasta < current_date))
      order by p.aceptado_at desc nulls last, p.updated_at desc)
    from presupuestos p
    left join clientes c on c.id = p.cliente_id
    where p.empresa_id = s.s_empresa and p.estado = 'aceptado'
    limit 50), '[]'::jsonb));
end;
$fn$;

-- Seguridad (receta 112): nunca public/anon; solo la sesión autenticada y el service_role.
revoke all on function :"schema".presupuestos_por_cobrar() from public, anon;
grant execute on function :"schema".presupuestos_por_cobrar() to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
