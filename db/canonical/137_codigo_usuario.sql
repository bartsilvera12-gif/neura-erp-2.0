-- =============================================================================
-- Código de empleado / usuario (pedido del dueño, 4-nov-2026).
--
--   usuarios.codigo: número correlativo POR EMPRESA (1, 2, 3…), se pone solo al crear el usuario y
--   no cambia nunca (aunque la persona se desactive). Los usuarios que ya existían se numeran por
--   fecha de alta. Lo muestran la lista y la ficha de RR HH (rrhh_listado / rrhh_ficha, redefinidas
--   rrhh_listado redefinida desde la 118 + codigo; rrhh_ficha se parchea, como hizo la 119).
--
-- IDEMPOTENTE. Va después de 136.
-- =============================================================================

begin;
set local search_path to :"schema", public;

alter table usuarios add column if not exists codigo integer;

-- Los que ya estaban: por fecha de alta, dentro de cada empresa, siguiendo el mayor que haya.
with ya as (select empresa_id, coalesce(max(codigo), 0) as base from usuarios group by empresa_id),
     faltan as (
       select u.id, y.base + row_number() over (partition by u.empresa_id order by u.creado_at, u.id) as n
         from usuarios u join ya y on y.empresa_id = u.empresa_id
        where u.codigo is null)
update usuarios u set codigo = f.n from faltan f where f.id = u.id;

alter table usuarios alter column codigo set not null;
create unique index if not exists usuarios_empresa_codigo_uq on usuarios (empresa_id, codigo);

-- Alta: el siguiente de su empresa (con lock por empresa: dos altas a la vez no chocan).
-- Cambio: el código no se toca (tampoco al pasar la persona a otra empresa: no pasa en la app).
create or replace function usuarios_codigo() returns trigger
language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if tg_op = 'UPDATE' then
    new.codigo := old.codigo;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('usuarios_codigo:' || new.empresa_id::text, 0));
  select coalesce(max(codigo), 0) + 1 into new.codigo from usuarios where empresa_id = new.empresa_id;
  return new;
end;
$fn$;
revoke all on function usuarios_codigo() from public, anon, authenticated;

drop trigger if exists usuarios_codigo_trg on usuarios;
create trigger usuarios_codigo_trg before insert or update of codigo on usuarios
  for each row execute function usuarios_codigo();

-- ── RR HH: la lista y la ficha traen el código ─────────────────────────────────────────────
create or replace function rrhh_listado()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
begin
  select * into s from rrhh_sesion();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'codigo', u.codigo, 'nombre', u.nombre, 'ci', u.ci, 'telefono', u.telefono, 'email', u.email, 'activo', u.activo,
      'perfil', pf.nombre, 'sucursal', su.nombre, 'tiene_legajo', l.usuario_id is not null,
      'area', l.area, 'tipo_salario', l.tipo_salario, 'salario', l.salario, 'fecha_ingreso', l.fecha_ingreso, 'fecha_egreso', l.fecha_egreso,
      'aporta_ips', l.aporta_ips, 'comisiona', l.comisiona
    ) order by u.activo desc, u.nombre)
    from usuarios u
    left join perfiles pf on pf.id = u.perfil_id
    left join sucursales su on su.id = u.sucursal_id
    left join rrhh_legajos l on l.usuario_id = u.id
   where u.empresa_id = s.s_empresa), '[]'::jsonb);
end;
$fn$;

-- rrhh_ficha la cambiaron la 118 y la 119 (perfil, sucursal y opciones): se le suma el código en su
-- definición actual, sin reescribirla.
do $do$
declare
  v_def text := pg_get_functiondef('rrhh_ficha(uuid)'::regprocedure);
  v_datos text := $a$'id', u.id, 'nombre', u.nombre, 'nombres'$a$;
begin
  if position($a$'codigo', u.codigo$a$ in v_def) = 0 then
    if position(v_datos in v_def) = 0 then raise exception 'Receta 137: rrhh_ficha no tiene el patrón esperado'; end if;
    execute replace(v_def, v_datos, $b$'id', u.id, 'codigo', u.codigo, 'nombre', u.nombre, 'nombres'$b$);
  end if;
end;
$do$;
commit;
