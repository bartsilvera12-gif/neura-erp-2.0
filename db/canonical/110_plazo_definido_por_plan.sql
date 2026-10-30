-- =============================================================================
-- EL PLAZO LO DEFINE EL PLAN (pedido del socio del dueño, 30-oct-2026).
--
--   Si querés un plan a 6 meses y otro a 12, son dos planes. Por eso:
--   · crear_suscripcion toma siempre el plazo del plan: ya no se elige en cada suscripción (corrige
--     lo que dejó 108).
--   · cambiar_plan_suscripcion le pasa a la suscripción el plazo del plan nuevo, que se sigue
--     contando desde su fecha de inicio. En "próximo mes" se cambia ya: emitir_cuota_suscripcion
--     revisa el plazo antes de aplicar el plan pendiente y rechazaría la primera cuota del plan nuevo.
--   · El plazo de un plan que ya usan suscripciones no se cambia: lo controla PATCH /api/planes/[id].
--
-- IDEMPOTENTE. Va después de 109.
-- =============================================================================

begin;
set local search_path to :"schema", public;

do $do$
declare
  v_def text;
  r record;
begin
  v_def := pg_get_functiondef('crear_suscripcion(jsonb)'::regprocedure);
  for r in select * from (values
    ($a$          case when p ? 'duracion_meses' then nullif(p->>'duracion_meses', '')::int else v_plan.duracion_meses end,  -- 108: sin indicar, el plazo del plan$a$,
     $b$          v_plan.duracion_meses,  -- 110: el plazo lo define el plan$b$)
  ) as x(patron, nuevo) loop
    if position(r.nuevo in v_def) = 0 then
      if position(r.patron in v_def) = 0 then raise exception 'Parche 110: crear_suscripcion no tiene el patrón esperado'; end if;
      execute replace(v_def, r.patron, r.nuevo);
    end if;
  end loop;

  v_def := pg_get_functiondef('cambiar_plan_suscripcion(uuid, uuid, text, numeric)'::regprocedure);
  for r in select * from (values
    ($a$pendiente_desde = (v_mes + interval '1 month')::date, updated_at = now()$a$,
     $b$pendiente_desde = (v_mes + interval '1 month')::date, duracion_meses = v_plan.duracion_meses, updated_at = now()$b$),
    ($a$set plan_id = v_plan.id, plan_nombre = v_plan.nombre, precio = v_precio, moneda = v_plan.moneda,$a$,
     $b$set plan_id = v_plan.id, plan_nombre = v_plan.nombre, duracion_meses = v_plan.duracion_meses, precio = v_precio, moneda = v_plan.moneda,$b$)
  ) as x(patron, nuevo) loop
    if position(r.nuevo in v_def) = 0 then
      if position(r.patron in v_def) = 0 then raise exception 'Parche 110: cambiar_plan_suscripcion no tiene el patrón esperado'; end if;
      v_def := replace(v_def, r.patron, r.nuevo);
    end if;
  end loop;
  execute v_def;
end;
$do$;

commit;

notify pgrst, 'reload schema';
