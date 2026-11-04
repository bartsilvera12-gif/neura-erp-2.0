-- Alquileres (receta 133): contrato, la cuota de cada mes con aumento, cobro y liquidación al dueño.
do $$
declare
  v jsonb;
  p1 jsonb;
  c1 jsonb;
  v_duena uuid;
  v_inq uuid;
  v_inicio date := (date_trunc('month', (now() at time zone 'America/Asuncion')::date) - interval '13 months')::date;
  v_mes date := date_trunc('month', (now() at time zone 'America/Asuncion')::date)::date;
  e1 jsonb; e2 jsonb;
  v_cxc uuid;
  v_efe numeric;
begin
  v := guardar_funciones_empresa('{"inmobiliaria": true}');
  insert into clientes (empresa_id, nombre, documento) values (pg_temp.fx('empresa'), 'PRUEBA Dueña Alquiler', 'PRUEBA-DA-1') returning id into v_duena;
  insert into clientes (empresa_id, nombre, documento) values (pg_temp.fx('empresa'), 'PRUEBA Inquilino', 'PRUEBA-IN-1') returning id into v_inq;
  p1 := propiedad_guardar(jsonb_build_object('titulo', 'PRUEBA Depto en alquiler', 'gestion', 'alquiler', 'precio_alquiler', 3500000,
    'propia', false, 'propietario_id', v_duena, 'comision_alquiler_pct', 8));

  perform pg_temp.rechaza('Alquiler: sin inquilino no hay contrato',
    format($q$select alquiler_guardar('{"propiedad_id": "%s", "monto": 3500000, "fecha_inicio": "2026-01-01"}')$q$, p1->>'id'), 'inquilino');
  perform pg_temp.rechaza('Alquiler: el dueño no se alquila a sí mismo',
    format($q$select alquiler_guardar('{"propiedad_id": "%s", "inquilino_id": "%s", "monto": 3500000, "fecha_inicio": "2026-01-01"}')$q$, p1->>'id', v_duena), 'dueño');

  c1 := alquiler_guardar(jsonb_build_object('propiedad_id', p1->>'id', 'inquilino_id', v_inq, 'monto', 3500000, 'dia_vencimiento', 10,
    'fecha_inicio', v_inicio, 'meses', 24, 'garantia', 3500000, 'ajuste_pct', 10, 'ajuste_cada_meses', 12));
  perform pg_temp.ok('Alquiler: nace vigente con número ALQ y copia dueño y comisión',
    c1->>'numero' ~ '^ALQ-\d{4}$' and c1->>'estado' = 'vigente' and c1->>'propietario' = 'PRUEBA Dueña Alquiler' and (c1->>'comision_pct')::numeric = 8, c1::text);
  perform pg_temp.ok('Alquiler: la propiedad queda alquilada', propiedad_detalle((p1->>'id')::uuid)->>'estado' = 'alquilada');
  perform pg_temp.rechaza('Alquiler: una propiedad alquilada no se alquila dos veces',
    format($q$select alquiler_guardar('{"propiedad_id": "%s", "inquilino_id": "%s", "monto": 1, "fecha_inicio": "2026-01-01"}')$q$, p1->>'id', pg_temp.fx('cliente')), 'alquilada');

  -- Cuota del primer mes y la de este mes (con el aumento de 10 % al año).
  e1 := alquiler_emitir((c1->>'id')::uuid, v_inicio);
  e2 := alquiler_emitir((c1->>'id')::uuid);
  perform pg_temp.igual('Alquiler: el primer mes es el monto del contrato', (e1->>'monto')::numeric, 3500000);
  perform pg_temp.igual('Alquiler: pasado el año se aplica el aumento', (e2->>'monto')::numeric, 3850000);
  perform pg_temp.ok('Alquiler: la cuota es una cuenta a cobrar del inquilino que vence el día 10',
    exists (select 1 from cuentas_por_cobrar where venta_id = (e2->>'venta_id')::uuid and cliente_id = v_inq and extract(day from vencimiento) = 10 and saldo = 3850000));
  perform pg_temp.rechaza('Alquiler: un mes no se emite dos veces', format($q$select alquiler_emitir(%L)$q$, c1->>'id'), 'ya está emitido');
  perform pg_temp.rechaza('Alquiler: no se emite fuera del contrato',
    format($q$select alquiler_emitir(%L, %L)$q$, c1->>'id', (v_inicio + interval '24 months')::date), 'fuera de la duración');
  v := alquileres_emitir_mes();
  perform pg_temp.ok('Alquiler: emitir el mes saltea los ya emitidos', (v->>'emitidas')::integer = 0 and jsonb_array_length(v->'saltados') >= 1, v::text);

  -- Cobrar y liquidar al dueño.
  select id into v_cxc from cuentas_por_cobrar where venta_id = (e1->>'venta_id')::uuid;
  perform registrar_cobro(jsonb_build_object('cliente_id', v_inq, 'caja_id', pg_temp.fx('caja'),
    'pagos', '[{"metodo": "efectivo", "monto": 3500000}]'::jsonb, 'aplicaciones', jsonb_build_array(jsonb_build_object('cxc_id', v_cxc, 'monto', 3500000))));
  v := alquiler_pendiente_duenos(v_duena);
  perform pg_temp.ok('Liquidación: el dueño tiene pendiente lo cobrado menos la comisión (8 %)',
    (v->0->>'cobrado')::numeric = 3500000 and (v->0->>'comision')::numeric = 280000 and (v->0->>'neto')::numeric = 3220000, v::text);
  perform pg_temp.ok('Liquidación: lo no cobrado no se liquida', jsonb_array_length(v->0->'cuotas') = 1);
  v_efe := pg_temp.efectivo();
  v := alquiler_liquidar(jsonb_build_object('propietario_id', v_duena, 'medio', 'efectivo', 'caja_id', pg_temp.fx('caja')));
  perform pg_temp.ok('Liquidación: se le paga el neto y queda numerada', (v->>'neto')::numeric = 3220000 and v->>'numero' ~ '^LIQ-\d{5}$', v::text);
  perform pg_temp.igual('Liquidación: en efectivo sale de la caja', v_efe - pg_temp.efectivo(), 3220000);
  perform pg_temp.rechaza('Liquidación: lo liquidado no se liquida dos veces',
    format($q$select alquiler_liquidar('{"propietario_id": "%s", "medio": "transferencia"}')$q$, v_duena), 'sin liquidar');
  perform pg_temp.ok('Liquidación: la cuota queda marcada', (alquiler_detalle((c1->>'id')::uuid)->'cuotas'->-1->>'liquidada')::boolean);

  -- Terminar el contrato.
  v := alquiler_estado((c1->>'id')::uuid, 'finalizado');
  perform pg_temp.ok('Alquiler: al terminarlo la propiedad vuelve a disponible y la deuda sigue',
    v->>'estado' = 'finalizado' and propiedad_detalle((p1->>'id')::uuid)->>'estado' = 'disponible' and (v->>'deuda')::numeric = 3850000, v::text);
  perform pg_temp.rechaza('Alquiler: terminado no emite', format($q$select alquiler_emitir(%L)$q$, c1->>'id'), 'finalizado');

  -- Seguridad.
  perform pg_temp.rechaza('Alquiler: nadie lee los contratos directo', $q$select * from alquiler_contratos$q$, 'permission denied');
  perform pg_temp.rechaza('Alquiler: sin sesión no se listan', $q$set local role anon; select alquileres_lista()$q$, 'permission denied');
  perform guardar_funciones_empresa('{"inmobiliaria": false}');
exception when others then
  execute 'set local role authenticated';
  perform pg_temp.como('admin');
  perform pg_temp.ok('Alquileres: el escenario se cortó', false, sqlerrm);
end $$;
