-- RR HH: los salarios solo los ve quien tiene el permiso, el historial queda solo y el mes cerrado no cambia.
do $$
declare
  v_caj uuid := (select id from usuarios where auth_user_id = pg_temp.fx('cajero'));
  v_base jsonb := jsonb_build_object('nombres', 'PRUEBA Cajero', 'fecha_ingreso', '2020-03-10', 'tipo_salario', 'mensualero', 'salario', 3000000, 'aporta_ips', true, 'comisiona', false, 'horario_dias', '[1,2,3]'::jsonb);
  v jsonb;
begin
  perform pg_temp.rechaza('RR HH: sin la fecha de ingreso no se guarda', format($q$select rrhh_guardar_legajo(%L, '{"nombres":"X","tipo_salario":"mensualero","salario":1}')$q$, v_caj), 'fecha de ingreso');
  perform rrhh_guardar_legajo(v_caj, v_base);
  v := rrhh_ficha(v_caj);
  perform pg_temp.igual('RR HH: el salario queda guardado', (v->'legajo'->>'salario')::numeric, 3000000);
  perform pg_temp.ok('RR HH: el alta queda en el historial', v->'historial' @> '[{"accion": "legajo_creado"}]');

  perform pg_temp.rechaza('RR HH: un aumento sin motivo no pasa', format($q$select rrhh_guardar_legajo(%L, %L)$q$, v_caj, v_base || '{"salario": 3500000}'), 'motivo');
  perform rrhh_guardar_legajo(v_caj, v_base || '{"salario": 3500000, "motivo_salario": "Aumento anual", "area": "Salón"}');
  v := rrhh_ficha(v_caj);
  perform pg_temp.ok('RR HH: el aumento queda con antes, después y motivo', v->'historial' @> '[{"accion": "salario", "detalle": {"antes": 3000000.00, "despues": 3500000, "motivo": "Aumento anual"}}]', (v->'historial')::text);
  perform pg_temp.ok('RR HH: el cambio de área queda campo por campo', v->'historial' @> '[{"accion": "actualizado", "detalle": {"cambios": [{"campo": "Área de trabajo", "despues": "Salón"}]}}]');

  perform rrhh_ausencia_guardar(v_caj, '{"fecha": "2026-10-05", "dias": 2, "tipo": "injustificada", "descuenta": true}');
  v := rrhh_liquidacion_datos('2026-10');
  perform pg_temp.igual('RR HH: la ausencia entra al mes', (select (x->'ausencias'->0->>'dias')::numeric from jsonb_array_elements(v->'personas') x where x->>'usuario_id' = v_caj::text), 2);
  v := rrhh_liquidacion_datos('2026-09');
  perform pg_temp.igual('RR HH: la ausencia no entra a otro mes', (select jsonb_array_length(x->'ausencias')::numeric from jsonb_array_elements(v->'personas') x where x->>'usuario_id' = v_caj::text), 0);

  perform rrhh_liquidacion_cerrar(v_caj, '2026-10', '{"imponible": 3266667, "neto": 2972667}');
  perform pg_temp.rechaza('RR HH: mes cerrado no toma ausencias', format($q$select rrhh_ausencia_guardar(%L, '{"fecha": "2026-10-20", "dias": 1, "tipo": "reposo", "descuenta": false}')$q$, v_caj), 'cerrada');
  perform pg_temp.rechaza('RR HH: mes cerrado no se ajusta', format($q$select rrhh_liquidacion_ajustar(%L, '2026-10', null, '[]')$q$, v_caj), 'cerrada');
  perform pg_temp.rechaza('RR HH: reabrir pide motivo', format($q$select rrhh_liquidacion_reabrir(%L, '2026-10', ' ')$q$, v_caj), 'motivo');
  perform rrhh_liquidacion_reabrir(v_caj, '2026-10', 'Faltaba un día');
  perform rrhh_ausencia_guardar(v_caj, '{"fecha": "2026-10-20", "dias": 1, "tipo": "reposo", "descuenta": false}');
  perform pg_temp.ok('RR HH: reabierta vuelve a tomar ausencias', true);

  perform rrhh_vacacion_guardar(v_caj, '{"desde": "2026-01-05", "hasta": "2026-01-16", "dias": 10}');
  perform pg_temp.rechaza('RR HH: vacaciones que se pisan', format($q$select rrhh_vacacion_guardar(%L, '{"desde": "2026-01-10", "hasta": "2026-01-12", "dias": 2}')$q$, v_caj), 'esas fechas');

  -- Comisiona = no sale de Comisiones.
  v := comisiones_datos('2026-10-01', '2026-10-31');
  if v->>'estado' = 'ok' then
    perform pg_temp.ok('RR HH: quien no comisiona se avisa a Comisiones', v->'no_comisionan' @> to_jsonb(array[v_caj::text]));
  end if;

  perform pg_temp.rechaza('RR HH: nadie lee los legajos directo', $q$select * from rrhh_legajos$q$, 'permission denied');
  perform pg_temp.rechaza('RR HH: nadie escribe el historial directo', $q$delete from rrhh_historial$q$, 'permission denied');
  perform pg_temp.como('cajero');
  perform pg_temp.rechaza('RR HH: el cajero no ve el personal', $q$select rrhh_listado()$q$, 'sin permiso');
  perform pg_temp.rechaza('RR HH: el cajero no se sube el salario', format($q$select rrhh_guardar_legajo(%L, %L)$q$, v_caj, v_base || '{"salario": 99000000, "motivo_salario": "x"}'), 'sin permiso');
  perform pg_temp.como('admin');
  perform pg_temp.rechaza('RR HH: sin sesión no entra', $q$set local role anon; select rrhh_listado()$q$, 'permission denied');
exception when others then
  perform pg_temp.como('admin');
  perform pg_temp.ok('RR HH: el escenario se cortó', false, sqlerrm);
end $$;
