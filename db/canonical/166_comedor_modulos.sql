-- =============================================================================
-- RUBRO COMEDOR: MENÚ ENFOCADO (166)
-- El rubro Comedor Empresarial deja un menú acotado como el de Kingspan: solo Comedor,
-- Inventario, Reportes (más Inicio y Configuración, que son fijos). Apaga Comercial, Caja,
-- Finanzas, Gastos, Omnicanal y RR HH. Antes (receta 165) solo apagaba Cuotas y Soporte.
-- Re-parchea el preset de módulos del rubro comedor en guardar_funciones_empresa.
-- Idempotente (guard por el nuevo valor). CONECTADO COMO postgres.
-- =============================================================================
set search_path = :"schema", public;

do $do$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('guardar_funciones_empresa(jsonb)'::regprocedure);
  if position($nuevo$when 'comedor' then '{comercial,caja,finanzas,gastos,omnicanal,rrhh,cuotas,soporte}'$nuevo$ in v_def) = 0 then
    if position($viejo$when 'comedor' then '{cuotas,soporte}'::text[]$viejo$ in v_def) = 0 then
      raise exception 'Receta 166: no está el preset de módulos del rubro comedor (¿falta la 165?)';
    end if;
    v_def := replace(v_def,
      $viejo$when 'comedor' then '{cuotas,soporte}'::text[]$viejo$,
      $nuevo$when 'comedor' then '{comercial,caja,finanzas,gastos,omnicanal,rrhh,cuotas,soporte}'::text[]$nuevo$);
    execute v_def;
  end if;
end;
$do$;
