-- =============================================================================
-- ENVÍOS — interruptor visible en "Rubro y funciones". Receta 175, va después de 170.
-- La 170 dejó `guardar_funciones_empresa` sin tocar (la función se encendía solo por SQL). Acá se
-- parchea para que el toggle de Envíos también se pueda prender/apagar desde la pantalla. Envíos es
-- un interruptor INDEPENDIENTE del rubro (como pedidos): cambiar de rubro NO lo toca; al prenderlo
-- se siembran los estados y se dan los permisos (rubro_dar_envios). IDEMPOTENTE (marcador 175).
-- =============================================================================
\set ON_ERROR_STOP on
begin;
set search_path to :"schema", public;

do $do$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('guardar_funciones_empresa(jsonb)'::regprocedure);
  if position('-- 175: envios' in v_def) > 0 then return; end if;

  -- 1. Declarar v_envios (ancla: la declaración que agregó la 165).
  if position('v_comedor boolean; -- 165: comedor rubro' in v_def) = 0 then raise exception 'Receta 175: falta la declaración v_comedor'; end if;
  v_def := replace(v_def, 'v_comedor boolean; -- 165: comedor rubro',
                          'v_comedor boolean; -- 165: comedor rubro' || E'\n  v_envios boolean; -- 175: envios');

  -- 2. Inicializar desde la fila actual.
  if position('v_comedor := f.comedor;' in v_def) = 0 then raise exception 'Receta 175: falta la inicialización v_comedor'; end if;
  v_def := replace(v_def, 'v_comedor := f.comedor;',
                          'v_comedor := f.comedor;' || E'\n  v_envios := coalesce(f.envios, false);');

  -- 3. Leer el flag del jsonb (NO se toca en el switch de rubro: es independiente).
  if position('if p ? ''comedor'' then v_comedor := (p->>''comedor'')::boolean; end if;' in v_def) = 0 then raise exception 'Receta 175: falta la lectura de comedor'; end if;
  v_def := replace(v_def, 'if p ? ''comedor'' then v_comedor := (p->>''comedor'')::boolean; end if;',
                          'if p ? ''comedor'' then v_comedor := (p->>''comedor'')::boolean; end if;' || E'\n  if p ? ''envios'' then v_envios := (p->>''envios'')::boolean; end if;');

  -- 4. Validación de tipo (que 'envios' sea sí/no).
  if position('''gimnasio'', ''comedor'', ''confirmar_recetas''' in v_def) = 0 then raise exception 'Receta 175: falta el array de validación'; end if;
  v_def := replace(v_def, '''gimnasio'', ''comedor'', ''confirmar_recetas''',
                          '''gimnasio'', ''comedor'', ''envios'', ''confirmar_recetas''');

  -- 5. Al prender: sembrar estados y dar pantallas/permisos a los perfiles.
  if position('if v_gimnasio and not f.gimnasio then perform rubro_dar_gimnasio(s.p_empresa); end if;' in v_def) = 0 then raise exception 'Receta 175: falta el gancho rubro_dar_gimnasio'; end if;
  v_def := replace(v_def, 'if v_gimnasio and not f.gimnasio then perform rubro_dar_gimnasio(s.p_empresa); end if;',
                          'if v_gimnasio and not f.gimnasio then perform rubro_dar_gimnasio(s.p_empresa); end if;' || E'\n  if v_envios and not coalesce(f.envios, false) then perform rubro_dar_envios(s.p_empresa); end if;');

  -- 6. UPDATE: guardar la columna.
  if position('gimnasio = v_gimnasio, comedor = v_comedor, updated_at = now()' in v_def) = 0 then raise exception 'Receta 175: falta el UPDATE esperado'; end if;
  v_def := replace(v_def, 'gimnasio = v_gimnasio, comedor = v_comedor, updated_at = now()',
                          'gimnasio = v_gimnasio, comedor = v_comedor, envios = v_envios, updated_at = now()');

  if position('-- 175: envios' in v_def) = 0 then raise exception 'Receta 175: el parche no quedó marcado'; end if;
  execute v_def;
end;
$do$;

commit;

notify pgrst, 'reload schema';
