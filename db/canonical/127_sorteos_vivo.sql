-- =============================================================================
-- SORTEOS: el sorteo se hace en un VIVO por redes (4-nov-2026). Los clientes no sortean en el sistema:
-- lo transmiten (Facebook, Instagram, TikTok) con su urna o su herramienta, y cargan el número que salió.
--   · sorteos.vivo_url: el link del vivo. La página pública lo muestra ("Mirá el sorteo en vivo")
--     antes y después del sorteo.
--   · sorteo_vivo_guardar(id, url): se puede poner o cambiar en cualquier estado (sorteos_administrar).
-- IDEMPOTENTE. Va después de 126.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

alter table :"schema".sorteos add column if not exists vivo_url text;

create or replace function :"schema".sorteo_vivo_guardar(p_id uuid, p_url text)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  select * into s from sorteo_sesion('sorteos_administrar');
  if v_url is not null and (v_url !~* '^https?://[^\s]+$' or length(v_url) > 500) then
    raise exception 'Pegá el link completo del vivo (empieza con https://)';
  end if;
  update sorteos set vivo_url = v_url, updated_at = now() where id = p_id and empresa_id = s.s_empresa;
  if not found then raise exception 'No existe ese sorteo'; end if;
  return sorteo_json(p_id);
end;
$fn$;

revoke all on function :"schema".sorteo_vivo_guardar(uuid, text) from public, anon;
grant execute on function :"schema".sorteo_vivo_guardar(uuid, text) to authenticated, service_role;

-- La página pública devuelve el link del vivo.
do $do$
declare
  v_def text := pg_get_functiondef('sorteo_publico(text)'::regprocedure);
begin
  if position('-- 127: vivo' in v_def) = 0 then
    if position($a$'verificacion', jsonb_build_object('semilla_hash'$a$ in v_def) = 0 then
      raise exception 'Receta 127: sorteo_publico no tiene el patrón esperado';
    end if;
    execute replace(v_def, $a$'verificacion', jsonb_build_object('semilla_hash'$a$,
      $b$'vivo_url', s.vivo_url, -- 127: vivo
    'verificacion', jsonb_build_object('semilla_hash'$b$);
  end if;
end;
$do$;

commit;

notify pgrst, 'reload schema';
