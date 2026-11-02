-- =============================================================================
-- RR HH: correo obligatorio con @ y parentesco del contacto de emergencia (pedido del dueño, 2-nov-2026).
-- El correo de la ficha es de contacto: el del acceso al sistema no cambia.
-- IDEMPOTENTE. Va después de 119.
-- =============================================================================

begin;
set local search_path to :"schema", public;

alter table :"schema".rrhh_legajos
  add column if not exists correo text,
  add column if not exists emergencia_parentesco text;

update :"schema".rrhh_legajos l set correo = u.email
  from :"schema".usuarios u
 where u.id = l.usuario_id and l.correo is null and u.email like '%_@_%';

do $do$
declare
  v_def text := pg_get_functiondef('rrhh_guardar_legajo(uuid,jsonb)'::regprocedure);
  v_par text[][] := array[
    [$a$  select * into o from rrhh_legajos where usuario_id = p_usuario for update;$a$,
     $b$  if coalesce(btrim(p->>'correo'), '') !~ '^[^[:space:]@]+@[^[:space:]@]+$' then raise exception 'Escribí un correo válido: tiene que tener @'; end if;

  select * into o from rrhh_legajos where usuario_id = p_usuario for update;$b$],
    [$a$rrhh_legajos as l (usuario_id, empresa_id, fecha_nacimiento,$a$,
     $b$rrhh_legajos as l (usuario_id, empresa_id, correo, emergencia_parentesco, fecha_nacimiento,$b$],
    [$a$values (p_usuario, s.s_empresa, nullif(p->>'fecha_nacimiento', '')::date,$a$,
     $b$values (p_usuario, s.s_empresa, btrim(p->>'correo'), nullif(btrim(p->>'emergencia_parentesco'), ''), nullif(p->>'fecha_nacimiento', '')::date,$b$],
    [$a$    fecha_nacimiento = excluded.fecha_nacimiento,$a$,
     $b$    correo = excluded.correo, emergencia_parentesco = excluded.emergencia_parentesco, fecha_nacimiento = excluded.fecha_nacimiento,$b$],
    [$a$      ('Nombre', u.nombre, v_nombre),$a$,
     $b$      ('Correo', o.correo, n.correo), ('Parentesco de emergencia', o.emergencia_parentesco, n.emergencia_parentesco), ('Nombre', u.nombre, v_nombre),$b$]
  ];
  i int;
begin
  if position('emergencia_parentesco' in v_def) = 0 then
    for i in 1 .. array_length(v_par, 1) loop
      if position(v_par[i][1] in v_def) = 0 then raise exception 'Receta 120: rrhh_guardar_legajo no tiene el patrón esperado (%)', i; end if;
      v_def := replace(v_def, v_par[i][1], v_par[i][2]);
    end loop;
    execute v_def;
  end if;
end;
$do$;

commit;

notify pgrst, 'reload schema';
