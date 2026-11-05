-- =============================================================================
-- Rubro Neura y Soporte como módulo (pedido del dueño, 5-nov-2026).
--
--   · Soporte pasa a ser un módulo que se apaga (receta 138): ningún rubro de cliente lo trae.
--   · Rubro "neura" (propio): todas las funciones prendidas y ningún módulo apagado = todas las
--     pantallas. funciones_empresa() lo informa cuando está todo prendido.
--   · Las empresas que ya existían: se les apaga Soporte, salvo que tengan todo prendido.
--
--   Parchea funciones_empresa() y guardar_funciones_empresa() sobre su definición actual.
-- IDEMPOTENTE. Va después de 138.
-- =============================================================================

begin;
set local search_path to :"schema", public;

alter table empresa_funciones alter column modulos_apagados set default '{soporte}';

create or replace function modulos_apagados_validos(p jsonb) returns text[]
language plpgsql immutable set search_path = :"schema", public as $fn$
declare
  v_k text;
  v_out text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' then raise exception 'Los módulos apagados deben ser una lista'; end if;
  for v_k in select jsonb_array_elements_text(p) loop
    if v_k not in ('comercial', 'caja', 'finanzas', 'gastos', 'inventario', 'reportes', 'omnicanal', 'rrhh', 'cuotas', 'soporte') then
      raise exception 'Módulo inválido: %', v_k;
    end if;
    if not v_k = any(v_out) then v_out := v_out || v_k; end if;
  end loop;
  return v_out;
end;
$fn$;
revoke all on function modulos_apagados_validos(jsonb) from public, anon, authenticated;

-- funciones_empresa: rubro "neura" con todo prendido; sin fila, Soporte apagado.
do $do$
declare
  v_def text := pg_get_functiondef('funciones_empresa()'::regprocedure);
  v_rubro text := 'v_rubro := case when ';
  v_vacio text := $a$coalesce(f.modulos_apagados, '{}'::text[])$a$;
begin
  if position($a$'neura'$a$ in v_def) = 0 then
    if position(v_rubro in v_def) = 0 or position(v_vacio in v_def) = 0 then
      raise exception 'Receta 139: funciones_empresa no tiene el patrón esperado';
    end if;
    v_def := replace(v_def, v_rubro, v_rubro || $b$coalesce(f.sorteos, false) and coalesce(f.inmobiliaria, false) and v_mesas and v_cocina and v_recetas and v_pedidos then 'neura' -- 139
                  when $b$);
    v_def := replace(v_def, v_vacio, $a$coalesce(f.modulos_apagados, '{soporte}'::text[])$a$);
    execute v_def;
  end if;
end;
$do$;

-- guardar_funciones_empresa: preset "neura" (todo) y Soporte apagado en los demás rubros.
do $do$
declare
  v_def text := pg_get_functiondef('guardar_funciones_empresa(jsonb)'::regprocedure);
  v_else text := $a$else raise exception 'Rubro inválido (Comercio, Gastronomía, Sorteos o Inmobiliaria)';$a$;
  v_sor text := $a$then '{comercial,inventario,cuotas}'::text[]$a$;
  v_inm text := $a$then '{inventario}'::text[] else '{}'::text[] end$a$;
begin
  if position($a$'neura'$a$ in v_def) = 0 then
    if position(v_else in v_def) = 0 or position(v_sor in v_def) = 0 or position(v_inm in v_def) = 0 then
      raise exception 'Receta 139: guardar_funciones_empresa no tiene el patrón esperado';
    end if;
    v_def := replace(v_def, v_else, $b$when 'neura' then v_mesas := true; v_cocina := true; v_recetas := true; v_pedidos := true; v_sorteos := true; v_inmobiliaria := true; -- 139
      else raise exception 'Rubro inválido (Comercio, Gastronomía, Sorteos, Inmobiliaria o Neura)';$b$);
    v_def := replace(v_def, v_sor, $b$then '{comercial,inventario,cuotas,soporte}'::text[]$b$);
    v_def := replace(v_def, v_inm, $b$then '{inventario,soporte}'::text[] when 'neura' then '{}'::text[] else '{soporte}'::text[] end$b$);
    execute v_def;
  end if;
end;
$do$;

-- Las que ya estaban: Soporte apagado, salvo las que tienen todo prendido.
update empresa_funciones
   set modulos_apagados = modulos_apagados || '{soporte}'::text[]
 where not 'soporte' = any(modulos_apagados)
   and not (mesas and cocina and recetas and pedidos and sorteos and inmobiliaria);

commit;
