-- =============================================================================
-- El rubro Gimnasio se muestra como "Asistencia" (pedido del dueño, 5-nov-2026): sirve también para
-- natación, artes marciales y academias. Por dentro sigue siendo la función `gimnasio`.
-- Cambia solo textos: los permisos (nombre y grupo) y los mensajes de las funciones.
-- IDEMPOTENTE. Va después de 151.
-- =============================================================================

begin;
set local search_path to :"schema", public;

do $do$
declare
  v_def text;
  f text;
begin
  v_def := pg_get_functiondef('permisos_catalogo()'::regprocedure);
  if position('Recepción del gimnasio' in v_def) > 0 then
    v_def := replace(v_def, $a$'Recepción del gimnasio: anotar y marcar asistencia', 'Gimnasio'$a$, $b$'Recepción de asistencia: anotar y marcar', 'Asistencia'$b$);
    v_def := replace(v_def, $a$'Dejar entrar a un alumno con deuda vencida',    'Gimnasio'$a$, $b$'Dejar entrar a un alumno con deuda vencida',    'Asistencia'$b$);
    v_def := replace(v_def, $a$'Administrar clases, precios y comisiones',      'Gimnasio'$a$, $b$'Administrar clases, precios y comisiones',      'Asistencia'$b$);
    execute v_def;
  end if;

  v_def := pg_get_functiondef('gim_sesion(text)'::regprocedure);
  if position('El gimnasio no está activo' in v_def) > 0 then
    execute replace(v_def, 'El gimnasio no está activo en tu empresa', 'Asistencia no está activa en tu empresa');
  end if;

  v_def := pg_get_functiondef('guardar_funciones_empresa(jsonb)'::regprocedure);
  if position('Inmobiliaria, Gimnasio o Neura' in v_def) > 0 then
    execute replace(v_def, 'Inmobiliaria, Gimnasio o Neura', 'Inmobiliaria, Asistencia o Neura');
  end if;
end;
$do$;

commit;
