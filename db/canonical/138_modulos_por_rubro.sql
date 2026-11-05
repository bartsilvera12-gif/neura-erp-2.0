-- =============================================================================
-- Módulos por rubro (pedido del dueño, 5-nov-2026).
--
--   Cada rubro deja solo los módulos que usa; en Rubro y funciones se prende o apaga cada uno.
--   empresa_funciones.modulos_apagados: lista de los apagados (vacía = todos, como antes).
--     comercial (Clientes, CRM, Presupuestos… y Configuración › Comisiones), caja, finanzas,
--     gastos, inventario, reportes, omnicanal, rrhh, cuotas (Configuración › Planes de cuotas y mora).
--   Presets: Comercio y Gastronomía = ninguno apagado; Sorteos = comercial, inventario, cuotas;
--   Inmobiliaria = inventario. Soporte y Configuración no se apagan.
--   Apagar solo oculta pantallas (menú, paneles y guard): no borra ni bloquea datos.
--
--   funciones_empresa() y guardar_funciones_empresa() se parchean sobre su definición actual
--   (las tocaron la 77, la 113, la 123 y la 130), sin reescribirlas.
--
-- IDEMPOTENTE. Va después de 137.
-- =============================================================================

begin;
set local search_path to :"schema", public;

alter table empresa_funciones add column if not exists modulos_apagados text[] not null default '{}';

create or replace function modulos_apagados_validos(p jsonb) returns text[]
language plpgsql immutable set search_path = :"schema", public as $fn$
declare
  v_k text;
  v_out text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' then raise exception 'Los módulos apagados deben ser una lista'; end if;
  for v_k in select jsonb_array_elements_text(p) loop
    if v_k not in ('comercial', 'caja', 'finanzas', 'gastos', 'inventario', 'reportes', 'omnicanal', 'rrhh', 'cuotas') then
      raise exception 'Módulo inválido: %', v_k;
    end if;
    if not v_k = any(v_out) then v_out := v_out || v_k; end if;
  end loop;
  return v_out;
end;
$fn$;
revoke all on function modulos_apagados_validos(jsonb) from public, anon, authenticated;

do $do$
declare
  v_def text := pg_get_functiondef('funciones_empresa()'::regprocedure);
  v_ancla text := $a$'ocultas', v_ocultas,$a$;
begin
  if position('modulos_apagados' in v_def) = 0 then
    if position(v_ancla in v_def) = 0 then raise exception 'Receta 138: funciones_empresa no tiene el patrón esperado'; end if;
    execute replace(v_def, v_ancla, v_ancla || $b$
    'modulos_apagados', to_jsonb(coalesce(f.modulos_apagados, '{}'::text[])), -- 138$b$);
  end if;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('guardar_funciones_empresa(jsonb)'::regprocedure);
  v_ancla text := 'return funciones_empresa();';
begin
  if position('modulos_apagados' in v_def) = 0 then
    if position(v_ancla in v_def) = 0 then raise exception 'Receta 138: guardar_funciones_empresa no tiene el patrón esperado'; end if;
    execute replace(v_def, v_ancla, $b$-- 138: módulos apagados (la lista que manda la pantalla, o el preset del rubro)
  if p ? 'modulos_apagados' then
    update empresa_funciones set modulos_apagados = modulos_apagados_validos(p->'modulos_apagados') where empresa_id = s.p_empresa;
  elsif p ? 'rubro' then
    update empresa_funciones
       set modulos_apagados = case p->>'rubro' when 'sorteos' then '{comercial,inventario,cuotas}'::text[]
                                               when 'inmobiliaria' then '{inventario}'::text[] else '{}'::text[] end
     where empresa_id = s.p_empresa;
  end if;
  $b$ || v_ancla);
  end if;
end;
$do$;

commit;
