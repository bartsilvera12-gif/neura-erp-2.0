-- =============================================================================
-- PRESUPUESTOS: CRÉDITO EN CUOTAS (pedido del socio del dueño, 30-oct-2026).
--
-- Igual que la caja (receta 98): en cuántas cuotas, en cuántos días vence la 1ª (plazo_dias) y cada
-- cuánto (mes, quincena o semana). Es lo que se propone: las fechas salen recién al vender. Al
-- convertir el presupuesto, la caja arranca con estos datos y se pueden cambiar antes de cobrar.
--
-- IDEMPOTENTE. Va después de 105.
-- =============================================================================

begin;
set local search_path to :"schema", public;

alter table :"schema".presupuestos
  add column if not exists cuotas integer not null default 1,
  add column if not exists cuotas_cada text not null default 'mes';
alter table :"schema".presupuestos drop constraint if exists chk_pres_cuotas;
alter table :"schema".presupuestos add constraint chk_pres_cuotas
  check (cuotas between 1 and 60 and cuotas_cada in ('mes', 'quincena', 'semana'));

do $do$
declare
  c record;
  v_def text;
begin
  for c in select * from (values
    ('guardar_presupuesto', $a$  v_plazo integer := nullif(p->>'plazo_dias', '')::integer;$a$,
      $b$  v_plazo integer := nullif(p->>'plazo_dias', '')::integer;
  v_cuotas integer := coalesce(nullif(p->>'cuotas', '')::integer, 1);   -- 106
  v_cada text := coalesce(nullif(p->>'cuotas_cada', ''), 'mes');$b$),
    ('guardar_presupuesto', $a$then raise exception 'Poné el plazo del crédito (en días)'; end if;$a$,
      $b$then raise exception 'Poné el plazo del crédito (en días)'; end if;
    if v_cuotas < 1 or v_cuotas > 60 then raise exception 'Las cuotas van de 1 a 60'; end if;
    if v_cada not in ('mes', 'quincena', 'semana') then raise exception 'Elegí cada cuánto se pagan las cuotas'; end if;$b$),
    ('guardar_presupuesto', $a$    v_plazo := null;$a$, $b$    v_plazo := null;
    v_cuotas := 1;
    v_cada := 'mes';$b$),
    ('guardar_presupuesto', $a$tipo_cambio, condicion, plazo_dias,$a$, $b$tipo_cambio, condicion, plazo_dias, cuotas, cuotas_cada,$b$),
    ('guardar_presupuesto', $a$v_cond, v_plazo, v_vend.id$a$, $b$v_cond, v_plazo, v_cuotas, v_cada, v_vend.id$b$),
    ('guardar_presupuesto', $a$plazo_dias = v_plazo,$a$, $b$plazo_dias = v_plazo, cuotas = v_cuotas, cuotas_cada = v_cada,$b$),
    ('presupuesto_duplicar', $a$tipo_cambio, condicion, plazo_dias,$a$, $b$tipo_cambio, condicion, plazo_dias, cuotas, cuotas_cada,$b$),
    ('presupuesto_duplicar', $a$r.condicion, r.plazo_dias,$a$, $b$r.condicion, r.plazo_dias, r.cuotas, r.cuotas_cada,$b$),
    ('presupuesto_json', $a$'plazo_dias', p.plazo_dias,$a$, $b$'plazo_dias', p.plazo_dias, 'cuotas', p.cuotas, 'cuotas_cada', p.cuotas_cada,$b$)
  ) x(fn, patron, nuevo)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = c.fn;
    if v_def is null then raise exception 'Parche 106: no existe %', c.fn; end if;
    if position(c.nuevo in v_def) > 0 then continue; end if;   -- ya aplicado
    if position(c.patron in v_def) = 0 then raise exception 'Parche 106: % no tiene el patrón esperado (%)', c.fn, left(c.patron, 60); end if;
    execute replace(v_def, c.patron, c.nuevo);
  end loop;
end;
$do$;

commit;

notify pgrst, 'reload schema';
