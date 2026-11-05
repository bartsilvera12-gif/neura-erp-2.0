-- Gimnasio (receta 150): rubro, clases con cupo, asistencias, membresía con clases por mes, clase suelta,
-- deuda vencida que frena la entrada (y se fuerza con motivo) y comisión de profesores. Recetas 151 (Agenda)
-- y 155 (el link de cada alumno para reservar, cancelar y marcar solo).
do $$
declare
  v jsonb;
  v_clase uuid;
  v_cita uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_plan uuid;
  v_as uuid;
  v_prod uuid;
  v_venta jsonb;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_admin uuid := (select id from usuarios where auth_user_id = pg_temp.fx('admin'));
begin
  -- Rubro.
  v := guardar_funciones_empresa('{"rubro": "gimnasio"}');
  perform pg_temp.ok('Gimnasio: el rubro prende la función y apaga Planes de cuotas',
    v->>'rubro' = 'gimnasio' and (v->>'gimnasio')::boolean and not (v->>'sorteos')::boolean and v->'modulos_apagados' ? 'cuotas', v::text);

  v := gim_config_guardar('{"precio_clase_suelta": 30000, "bloquear_morosos": true, "comision_modo": "por_alumno", "comision_monto": 10000}');
  perform pg_temp.ok('Gimnasio: guarda precio de clase suelta y comisión', (v->>'precio_clase_suelta')::numeric = 30000 and v->>'comision_modo' = 'por_alumno', v::text);

  -- Clase de todos los días con 1 lugar: aparece sola en el día.
  perform pg_temp.rechaza('Gimnasio: una clase sin días no se guarda',
    $q$select gim_clase_guardar('{"nombre": "PRUEBA Sin días", "dias": [], "hora": "10:00"}')$q$, 'día');
  v_clase := (gim_clase_guardar(jsonb_build_object('nombre', 'PRUEBA Natación', 'profesor_id', v_admin, 'dias', jsonb_build_array(1,2,3,4,5,6,7),
    'hora', '23:00', 'duracion_min', 30, 'cupo', 1))->>'id')::uuid;
  v := gim_dia(v_hoy);
  select (x->>'cita_id')::uuid into v_cita from jsonb_array_elements(v->'clases') x where x->>'clase_id' = v_clase::text;
  perform pg_temp.ok('Gimnasio: la clase aparece en el día', v_cita is not null, v::text);
  perform gim_dia(v_hoy);
  perform pg_temp.igual('Gimnasio: mirar el día dos veces no duplica la clase',
    (select count(*) from agenda_citas where gim_clase_id = v_clase and (inicio_at at time zone 'America/Asuncion')::date = v_hoy), 1);

  insert into clientes (empresa_id, nombre) values (pg_temp.fx('empresa'), 'PRUEBA Alumno Suelto') returning id into v_a;
  insert into clientes (empresa_id, nombre) values (pg_temp.fx('empresa'), 'PRUEBA Alumno Sin Lugar') returning id into v_b;
  insert into clientes (empresa_id, nombre) values (pg_temp.fx('empresa'), 'PRUEBA Alumno Socio') returning id into v_c;
  insert into clientes (empresa_id, nombre) values (pg_temp.fx('empresa'), 'PRUEBA Alumno Moroso') returning id into v_d;

  -- Cupo.
  v := gim_anotar(v_cita, v_a);
  perform pg_temp.ok('Gimnasio: anota al alumno pendiente', v->>'estado' = 'pendiente', v::text);
  perform pg_temp.rechaza('Gimnasio: no se anota dos veces', format('select gim_anotar(%L, %L)', v_cita, v_a), 'Ya está anotado');
  perform pg_temp.rechaza('Gimnasio: con el cupo lleno no se anota', format('select gim_anotar(%L, %L)', v_cita, v_b), 'llena');

  -- Sin membresía: culmina y se cobra la clase suelta (venta a crédito que vence hoy).
  v_as := (v->>'id')::uuid;
  v := gim_asistencia_estado(v_as, 'en_espera');
  perform pg_temp.ok('Gimnasio: Llegó deja la asistencia en espera', v->>'estado' = 'en_espera' and v->>'llegada_at' is not null, v::text);
  perform pg_temp.rechaza('Gimnasio: en espera no vuelve a pendiente', format('select gim_asistencia_estado(%L, %L)', v_as, 'pendiente'), 'Ya llegó');
  v := gim_asistencia_estado(v_as, 'culminada');
  perform pg_temp.ok('Gimnasio: sin membresía se cobra como clase suelta', not (v->>'cubierta')::boolean and v->>'venta_id' is not null and (v->>'valor')::numeric = 30000, v::text);
  perform pg_temp.ok('Gimnasio: la clase suelta queda a cobrar, vence hoy y es ticket sin RUC',
    exists (select 1 from ventas vt join cuentas_por_cobrar c on c.venta_id = vt.id
             where vt.id = (v->>'venta_id')::uuid and vt.total = 30000 and vt.tipo_venta = 'CREDITO' and vt.tipo_documento = 'ticket'
               and not vt.comisionable and c.vencimiento = v_hoy and c.saldo = 30000));
  perform pg_temp.rechaza('Gimnasio: una asistencia culminada no cambia más', format('select gim_asistencia_estado(%L, %L)', v_as, 'no_asistio'), 'cerrada');
  v := gim_cliente(v_a);
  perform pg_temp.ok('Gimnasio: lo que debe hoy no lo frena (todavía no venció)', not (v->>'bloqueado')::boolean and (v->>'deuda_total')::numeric = 30000, v::text);

  -- Membresía de 1 clase por mes: la primera la cubre, la segunda se cobra suelta.
  insert into planes (empresa_id, nombre, precio, moneda, tipo_iva, activo, gim_clases_mes)
  values (pg_temp.fx('empresa'), 'PRUEBA Membresía 1 clase', 200000, 'GS', '10%', true, 1) returning id into v_plan;
  perform crear_suscripcion(jsonb_build_object('cliente_id', v_c, 'plan_id', v_plan, 'fecha_inicio', date_trunc('month', v_hoy)::date));
  v := gim_entrada(v_c);
  perform pg_temp.ok('Gimnasio: la membresía cubre la entrada', (v->>'cubierta')::boolean and v->>'venta_id' is null and v->>'estado' = 'culminada', v::text);
  perform pg_temp.rechaza('Gimnasio: dos entradas libres el mismo día no', format('select gim_entrada(%L)', v_c), 'Ya tiene la entrada');
  v := gim_cliente(v_c);
  perform pg_temp.ok('Gimnasio: la ficha muestra las clases que le quedan', (v->'membresia'->>'restantes')::int = 0 and (v->'membresia'->>'usadas')::int = 1, v::text);
  v := gim_turno_crear(jsonb_build_object('cliente_id', v_c, 'profesor_id', v_admin, 'inicio_at', (v_hoy + time '06:00') at time zone 'America/Asuncion', 'duracion_min', 30, 'titulo', 'PRUEBA Personal'));
  v := gim_asistencia_estado((v->>'id')::uuid, 'culminada');
  perform pg_temp.ok('Gimnasio: con las clases del mes usadas, la siguiente se cobra suelta', not (v->>'cubierta')::boolean and v->>'venta_id' is not null, v::text);
  perform pg_temp.ok('Gimnasio: el turno individual completa su cita de la Agenda',
    exists (select 1 from agenda_citas where id = (v->>'cita_id')::uuid and estado = 'completada' and tipo = 'clase'));

  -- Deuda vencida: frena la entrada; forzarla pide motivo y queda registrada.
  v_prod := pg_temp.producto('Cuota vieja', 150000);
  perform pg_temp.comprar(v_prod, 1, 1000);
  v_venta := pg_temp.vender_a(v_d, v_prod, 1, 'CREDITO');
  execute 'set local role service_role';
  update cuentas_por_cobrar set vencimiento = v_hoy - 10 where venta_id = (v_venta->>'venta_id')::uuid;
  execute 'set local role authenticated';
  v := gim_cliente(v_d);
  perform pg_temp.ok('Gimnasio: con deuda vencida sale bloqueado', (v->>'bloqueado')::boolean and (v->>'deuda_vencida')::numeric = 150000, v::text);
  perform pg_temp.rechaza('Gimnasio: con deuda vencida no entra', format('select gim_entrada(%L)', v_d), 'deuda vencida de Gs. 150.000');
  perform pg_temp.rechaza('Gimnasio: forzar la entrada pide motivo', format('select gim_entrada(%L, true, null)', v_d), 'motivo');
  v := gim_entrada(v_d, true, 'PRUEBA pagó por transferencia');
  perform pg_temp.ok('Gimnasio: forzada con motivo entra y queda marcada', (v->>'forzada')::boolean and v->>'estado' = 'culminada', v::text);
  execute 'set local role service_role';
  perform pg_temp.ok('Gimnasio: queda quién la forzó y por qué',
    exists (select 1 from gim_asistencias where id = (v->>'id')::uuid and forzada_por = v_admin and forzada_motivo = 'PRUEBA pagó por transferencia'));
  execute 'set local role authenticated';

  -- Comisión: por alumno, solo las asistencias con profesor (clase y turno; la entrada libre no).
  v := gim_comisiones(v_hoy, v_hoy);
  perform pg_temp.ok('Gimnasio: comisión por alumno del profesor',
    exists (select 1 from jsonb_array_elements(v->'profesores') x
             where (x->>'profesor_id')::uuid = v_admin and (x->>'alumnos')::int >= 2 and (x->>'comision')::numeric = (x->>'alumnos')::numeric * 10000), v::text);

  -- Receta 151: la Agenda manda la asistencia.
  v := gim_turno_crear(jsonb_build_object('cliente_id', v_a, 'profesor_id', v_admin, 'inicio_at', (v_hoy + time '07:00') at time zone 'America/Asuncion', 'duracion_min', 30));
  update agenda_citas set estado = 'completada' where id = (v->>'cita_id')::uuid;
  perform pg_temp.ok('Gimnasio: completar el turno en la Agenda culmina la asistencia y cobra la clase',
    (gim_cliente(v_a)->'historial'->0->>'estado') = 'culminada' and (gim_cliente(v_a)->>'deuda_total')::numeric = 60000, gim_cliente(v_a)::text);
  v := gim_turno_crear(jsonb_build_object('cliente_id', v_d, 'profesor_id', v_admin, 'inicio_at', (v_hoy + time '08:00') at time zone 'America/Asuncion', 'duracion_min', 30));
  perform pg_temp.rechaza('Gimnasio: Llegó en la Agenda también frena a quien debe',
    format($q$update agenda_citas set estado = 'en_espera' where id = %L$q$, v->>'cita_id'), 'deuda vencida');
  v := gim_turno_crear(jsonb_build_object('cliente_id', v_b, 'profesor_id', v_admin, 'inicio_at', (v_hoy + time '09:00') at time zone 'America/Asuncion', 'duracion_min', 30));
  insert into agenda_citas (empresa_id, cliente_id, responsable_id, titulo, tipo, estado, inicio_at, fin_at, reprogramada_de_id)
  select empresa_id, cliente_id, responsable_id, titulo, tipo, 'pendiente', inicio_at + interval '1 day', fin_at + interval '1 day', id
    from agenda_citas where id = (v->>'cita_id')::uuid
  returning id into v_cita;
  update agenda_citas set estado = 'reprogramada' where id = (v->>'cita_id')::uuid;
  v := gim_cliente(v_b);
  perform pg_temp.ok('Gimnasio: reprogramar en la Agenda pasa al alumno al turno nuevo',
    exists (select 1 from jsonb_array_elements(v->'proximas') x where (x->>'cita_id')::uuid = v_cita and x->>'estado' = 'pendiente')
    and exists (select 1 from jsonb_array_elements(v->'historial') x where x->>'estado' = 'reagendada'), v::text);
  v := gim_dia(v_hoy + 1);
  select (x->>'cita_id')::uuid into v_cita from jsonb_array_elements(v->'clases') x where x->>'clase_id' = v_clase::text;
  perform gim_anotar(v_cita, v_b);
  update agenda_citas set estado = 'cancelada' where id = v_cita;
  perform pg_temp.ok('Gimnasio: cancelar la clase en la Agenda cancela a sus alumnos',
    (select bool_and(x->>'estado' = 'cancelada') from jsonb_array_elements(gim_cliente(v_b)->'historial') x where (x->>'cita_id')::uuid = v_cita));

  -- Receta 155: cada alumno con su link reserva, cancela y marca solo (sin CI ni PIN).
  insert into clientes (empresa_id, nombre) values (pg_temp.fx('empresa'), 'PRUEBA Alumna Sola') returning id into v_b;
  declare
    v_tok text := (gim_alumno_link(v_b))->>'token';
    v_tok_d text := (gim_alumno_link(v_d))->>'token';
    v_man uuid;
    v_ya uuid;
    v_emp text := (gim_autoasistencia_link())->>'token';
    r jsonb;
  begin
    perform pg_temp.ok('Link del alumno: 48 caracteres', v_tok ~ '^[0-9a-f]{48}$', v_tok);
    perform pg_temp.ok('Link del alumno: pedirlo de nuevo da el mismo', (gim_alumno_link(v_b))->>'token' = v_tok);
    perform pg_temp.ok('Link del alumno: la ficha dice que lo tiene', (gim_cliente(v_b)->>'tiene_link')::boolean);
    v := gim_dia(v_hoy + 2);
    select (x->>'cita_id')::uuid into v_man from jsonb_array_elements(v->'clases') x where x->>'clase_id' = v_clase::text;
    insert into agenda_citas (empresa_id, responsable_id, titulo, tipo, estado, inicio_at, fin_at, gim_clase_id, metadata)
    values (pg_temp.fx('empresa'), v_admin, 'PRUEBA Ya empieza', 'clase', 'confirmada', now() + interval '10 minutes', now() + interval '40 minutes', v_clase, '{"gim_cupo": 2}')
    returning id into v_ya;

    execute 'set local role anon';
    r := gim_publico_mio(v_tok);
    perform pg_temp.ok('Link del alumno: ve sus clases de la semana',
      (r->>'ok')::boolean and exists (select 1 from jsonb_array_elements(r->'alumno'->'clases') x where (x->>'cita_id')::uuid = v_man and (x->>'puede_reservar')::boolean)
      and exists (select 1 from jsonb_array_elements(r->'alumno'->'clases') x where (x->>'cita_id')::uuid = v_ya and (x->>'puede_marcar')::boolean), r::text);
    r := gim_publico_accion(v_tok, 'marcar', v_man);
    perform pg_temp.ok('Link del alumno: una clase de otro día no se marca', not (r->>'ok')::boolean and r->>'error' like '%no es de hoy%', r::text);
    r := gim_publico_accion(v_tok, 'reservar', v_man);
    perform pg_temp.ok('Link del alumno: reserva una clase de otro día', (r->>'ok')::boolean
      and exists (select 1 from jsonb_array_elements(r->'alumno'->'clases') x where (x->>'cita_id')::uuid = v_man and x->>'estado' = 'confirmada' and (x->>'puede_cancelar')::boolean), r::text);
    r := gim_publico_accion(v_tok_d, 'reservar', v_man);
    perform pg_temp.ok('Link del alumno: con la clase llena no reserva', not (r->>'ok')::boolean and r->>'error' like '%llena%', r::text);
    r := gim_publico_accion(v_tok, 'cancelar', v_man);
    perform pg_temp.ok('Link del alumno: cancela su reserva y libera el lugar', (r->>'ok')::boolean
      and exists (select 1 from jsonb_array_elements(r->'alumno'->'clases') x where (x->>'cita_id')::uuid = v_man and x->>'estado' is null and (x->>'puede_reservar')::boolean), r::text);
    r := gim_publico_accion(v_tok, 'reservar', v_man);
    perform pg_temp.ok('Link del alumno: vuelve a reservar después de cancelar', (r->>'ok')::boolean, r::text);
    r := gim_publico_accion(v_tok, 'marcar', v_ya);
    perform pg_temp.ok('Link del alumno: marca la clase de ahora sin estar anotado, la culmina y cobra suelta',
      (r->>'ok')::boolean and not (r->'hecho'->>'cubierta')::boolean and (r->'hecho'->>'valor')::numeric = 30000, r::text);
    r := gim_publico_accion(v_tok, 'marcar', v_ya);
    perform pg_temp.ok('Link del alumno: no marca dos veces', not (r->>'ok')::boolean and r->>'error' like 'Ya marcaste%', r::text);
    r := gim_publico_accion(v_tok, 'cancelar', v_ya);
    perform pg_temp.ok('Link del alumno: una clase ya empezada o marcada no se cancela', not (r->>'ok')::boolean, r::text);
    r := gim_publico_accion(v_tok, 'libre', null);
    perform pg_temp.ok('Link del alumno: entrada libre', (r->>'ok')::boolean and (r->'alumno'->>'entrada_libre_hoy')::boolean, r::text);
    r := gim_publico_accion(v_tok, 'libre', null);
    perform pg_temp.ok('Link del alumno: una sola entrada libre por día', not (r->>'ok')::boolean and r->>'error' like 'Ya marcaste%', r::text);
    r := gim_publico_accion(v_tok_d, 'marcar', v_ya);
    perform pg_temp.ok('Link del alumno: con deuda vencida lo manda a recepción', not (r->>'ok')::boolean and r->>'error' like '%recepción%', r::text);
    r := gim_publico_mio(v_tok_d);
    perform pg_temp.ok('Link del alumno: con deuda vencida sale bloqueado y no puede marcar', (r->'alumno'->>'bloqueado')::boolean
      and not exists (select 1 from jsonb_array_elements(r->'alumno'->'clases') x where (x->>'puede_marcar')::boolean), r::text);
    perform pg_temp.rechaza('Link del alumno: un link inventado no sirve', format('select gim_publico_mio(%L)', repeat('a', 48)), 'no es válido');
    perform pg_temp.ok('Link del alumno: el link de la empresa (153) se reconoce para avisar', (gim_publico_info(v_emp))->>'tipo' = 'empresa');
    perform pg_temp.rechaza('Link del alumno: sin sesión no se crea un link', format('select gim_alumno_link(%L)', v_b), 'permission denied');
    execute 'set local role authenticated';
    v_tok_d := (gim_alumno_link(v_d, true))->>'token';
    execute 'set local role anon';
    perform pg_temp.ok('Link del alumno: rehacer el link deja el nuevo andando', (gim_publico_mio(v_tok_d)->>'ok')::boolean);
    execute 'set local role authenticated';
  end;

  -- Sin sesión no se usa.
  perform pg_temp.rechaza('Gimnasio: sin sesión no se ve el día', $q$set local role anon; select gim_dia()$q$, 'permission denied');
  execute 'set local role authenticated';
end $$;
