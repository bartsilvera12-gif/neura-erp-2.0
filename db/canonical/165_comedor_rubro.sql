-- =============================================================================
-- RUBRO COMEDOR EMPRESARIAL (165)
-- El comedor (receta 161) deja de ser solo un interruptor suelto y pasa a ser un RUBRO más
-- (como Gimnasio en la 150): la tarjeta "Comedor Empresarial" en Rubro y funciones lo prende.
--   · guardar_funciones_empresa: preset 'comedor' (prende comedor, apaga lo demás), variable
--     v_comedor, 'comedor' en la validación y el UPDATE, y módulos apagados {cuotas,soporte}.
--   · funciones_empresa: deriva el rubro 'comedor' (comedor on y lo demás off) y lo suma al 'neura'.
-- Idempotente: se guarda por el marcador '-- 165: comedor rubro'. Todo en UN do block (atómico:
-- si algún patrón no coincide, raise y no redefine nada). SECURITY/owner se conservan (CREATE OR REPLACE).
-- CONECTADO COMO postgres.
-- =============================================================================
set search_path = :"schema", public;

do $do$
declare
  v_def text;
begin
  -- ── guardar_funciones_empresa ───────────────────────────────────────────────
  v_def := pg_get_functiondef('guardar_funciones_empresa(jsonb)'::regprocedure);
  if position('-- 165: comedor rubro' in v_def) = 0 then
    -- variable e init
    v_def := replace(v_def, $a$  v_gimnasio boolean; -- 150: gimnasio$a$,
      $a$  v_gimnasio boolean; -- 150: gimnasio
  v_comedor boolean; -- 165: comedor rubro$a$);
    v_def := replace(v_def, $a$  v_gimnasio := f.gimnasio;$a$,
      $a$  v_gimnasio := f.gimnasio;
  v_comedor := f.comedor;$a$);
    -- comercio/gastronomía/sorteos/inmobiliaria terminan en "v_gimnasio := false;" → apagan comedor
    v_def := replace(v_def, $a$v_gimnasio := false;$a$, $a$v_gimnasio := false; v_comedor := false;$a$);
    -- neura prende todo, también comedor
    v_def := replace(v_def, $a$v_gimnasio := true; -- 139$a$, $a$v_gimnasio := true; v_comedor := true; -- 139$a$);
    -- el caso gimnasio (único: inmobiliaria:=false y gimnasio:=true) apaga comedor
    v_def := replace(v_def, $a$v_inmobiliaria := false; v_gimnasio := true;$a$,
      $a$v_inmobiliaria := false; v_gimnasio := true; v_comedor := false;$a$);
    -- nuevo caso 'comedor' + mensaje de error con Comedor
    v_def := replace(v_def,
      $a$      else raise exception 'Rubro inválido (Comercio, Gastronomía, Sorteos, Inmobiliaria, Asistencia o Neura)';$a$,
      $a$      when 'comedor' then v_mesas := false; v_cocina := false; v_recetas := false; v_pedidos := false; v_sorteos := false; v_inmobiliaria := false; v_gimnasio := false; v_comedor := true; -- 165: comedor rubro
      else raise exception 'Rubro inválido (Comercio, Gastronomía, Sorteos, Inmobiliaria, Asistencia, Comedor o Neura)';$a$);
    -- validación booleana del flag
    v_def := replace(v_def, $a$'inmobiliaria', 'gimnasio', 'confirmar_recetas'$a$,
      $a$'inmobiliaria', 'gimnasio', 'comedor', 'confirmar_recetas'$a$);
    -- lectura del flag suelto
    v_def := replace(v_def, $a$  if p ? 'gimnasio' then v_gimnasio := (p->>'gimnasio')::boolean; end if;$a$,
      $a$  if p ? 'gimnasio' then v_gimnasio := (p->>'gimnasio')::boolean; end if;
  if p ? 'comedor' then v_comedor := (p->>'comedor')::boolean; end if;$a$);
    -- UPDATE guarda comedor
    v_def := replace(v_def, $a$gimnasio = v_gimnasio, updated_at = now()$a$,
      $a$gimnasio = v_gimnasio, comedor = v_comedor, updated_at = now()$a$);
    -- módulos apagados del preset comedor
    v_def := replace(v_def,
      $a$when 'gimnasio' then '{cuotas,soporte}'::text[] when 'neura' then '{}'::text[]$a$,
      $a$when 'gimnasio' then '{cuotas,soporte}'::text[] when 'comedor' then '{cuotas,soporte}'::text[] when 'neura' then '{}'::text[]$a$);
    -- guardas: si algún patrón no coincidió, abortar sin redefinir
    if position('v_comedor := f.comedor;' in v_def) = 0
       or position($a$when 'comedor' then$a$ in v_def) = 0
       or position('comedor = v_comedor,' in v_def) = 0
       or position($a$if p ? 'comedor' then$a$ in v_def) = 0
       or position($a$when 'comedor' then '{cuotas,soporte}'$a$ in v_def) = 0 then
      raise exception 'Receta 165: guardar_funciones_empresa no tiene el patrón esperado';
    end if;
    execute v_def;
  end if;

  -- ── funciones_empresa (deriva el rubro) ─────────────────────────────────────
  v_def := pg_get_functiondef('funciones_empresa()'::regprocedure);
  if position('-- 165: comedor rubro' in v_def) = 0 then
    -- neura también exige comedor
    v_def := replace(v_def, $a$coalesce(f.gimnasio, false) then 'neura' -- 139$a$,
      $a$coalesce(f.gimnasio, false) and coalesce(f.comedor, false) then 'neura' -- 139$a$);
    -- caso 'comedor' antes que el de gimnasio
    v_def := replace(v_def,
      $a$when coalesce(f.gimnasio, false) and not coalesce(f.inmobiliaria, false) and not coalesce(f.sorteos, false) and not v_mesas and not v_cocina and not v_recetas then 'gimnasio' -- 150: gimnasio$a$,
      $a$when coalesce(f.comedor, false) and not coalesce(f.gimnasio, false) and not coalesce(f.inmobiliaria, false) and not coalesce(f.sorteos, false) and not v_mesas and not v_cocina and not v_recetas then 'comedor' -- 165: comedor rubro
                  when coalesce(f.comedor, false) then 'personalizado' -- 165
                  when coalesce(f.gimnasio, false) and not coalesce(f.inmobiliaria, false) and not coalesce(f.sorteos, false) and not v_mesas and not v_cocina and not v_recetas then 'gimnasio' -- 150: gimnasio$a$);
    if position($a$then 'comedor' -- 165: comedor rubro$a$ in v_def) = 0 then
      raise exception 'Receta 165: funciones_empresa no tiene el patrón esperado';
    end if;
    execute v_def;
  end if;
end;
$do$;
