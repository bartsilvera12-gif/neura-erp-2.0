-- =============================================================================
-- Presupuestos: el mismo tope de cuotas que la venta (receta 131: facturacion_config.max_cuotas,
-- 120 por defecto, hasta 360). Antes cortaba en 60. IDEMPOTENTE. Va después de 131.
-- =============================================================================

begin;
set local search_path to :"schema", public;

alter table :"schema".presupuestos drop constraint if exists chk_pres_cuotas;
alter table :"schema".presupuestos add constraint chk_pres_cuotas
  check (cuotas between 1 and 360 and cuotas_cada in ('mes', 'quincena', 'semana'));

do $do$
declare
  v_def text := pg_get_functiondef((select p.oid from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = 'guardar_presupuesto'));
  v_viejo text := $a$if v_cuotas < 1 or v_cuotas > 60 then raise exception 'Las cuotas van de 1 a 60'; end if;$a$;
begin
  if position('-- 132: tope de cuotas' in v_def) = 0 then
    if position(v_viejo in v_def) = 0 then raise exception 'Receta 132: guardar_presupuesto no tiene el patrón esperado'; end if;
    execute replace(v_def, v_viejo,
      $b$if v_cuotas < 1 or v_cuotas > max_cuotas_empresa(empresa_actual()) then -- 132: tope de cuotas
      raise exception 'Las cuotas van de 1 a %', max_cuotas_empresa(empresa_actual());
    end if;$b$);
  end if;
end;
$do$;

commit;

notify pgrst, 'reload schema';
