-- Sorteos por WhatsApp (receta 125): el comprobante leído se chequea en la base (monto, fecha, cuenta de
-- destino, operación repetida) y solo confirma solo si todo coincide y el sorteo lo permite.
do $$
declare
  v jsonb;
  v_s uuid;
  v_emp uuid := pg_temp.fx('empresa');
  o1 jsonb; o2 jsonb; o3 jsonb; o4 jsonb;
  v_hoy text := to_char((now() at time zone 'America/Asuncion')::date, 'YYYY-MM-DD');
  v_lectura jsonb;
begin
  perform guardar_funciones_empresa('{"sorteos": true}');
  v := sorteo_guardar(jsonb_build_object(
    'nombre', 'PRUEBA Sorteo WhatsApp', 'precio', 10000, 'numero_desde', 1, 'numero_hasta', 50, 'confirmacion_auto', true,
    'combos', '[{"cantidad": 3, "precio": 25000}]'::jsonb,
    'datos_pago', '[{"banco": "Banco PRUEBA", "titular": "Rifas Prueba S.A.", "cuenta": "0012-345678", "documento": "80012345-6"}]'::jsonb));
  v_s := (v->>'id')::uuid;
  perform sorteo_estado(v_s, 'activo');

  -- Configuración del bot (Administrador).
  v := sorteo_bot_config_guardar('{"activo": true, "bienvenida": "Hola desde PRUEBA"}');
  perform pg_temp.ok('Sorteos WhatsApp: el administrador prende el bot', (v->>'activo')::boolean and v->>'bienvenida' = 'Hola desde PRUEBA', v::text);
  perform pg_temp.ok('Sorteos WhatsApp: la configuración lista los sorteos a la venta',
    exists (select 1 from jsonb_array_elements(v->'sorteos') x where x->>'id' = v_s::text), v::text);
  perform pg_temp.rechaza('Sorteos WhatsApp: el canal tiene que ser de la empresa',
    $q$select sorteo_bot_config_guardar('{"activo": true, "canal_id": "00000000-0000-0000-0000-000000000000"}')$q$, 'no es de WhatsApp');

  execute 'set local role service_role';
  o1 := sorteo_orden_registrar(v_emp, jsonb_build_object('sorteo_id', v_s, 'cantidad', 3, 'canal', 'whatsapp', 'estado', 'pendiente_pago',
    'comprador', '{"nombre": "PRUEBA Wa Uno", "documento": "6000001", "telefono": "595991000101", "ciudad": "Luque"}'::jsonb));
  o2 := sorteo_orden_registrar(v_emp, jsonb_build_object('sorteo_id', v_s, 'cantidad', 1, 'canal', 'whatsapp', 'estado', 'pendiente_pago',
    'comprador', '{"nombre": "PRUEBA Wa Dos", "documento": "6000002", "telefono": "595991000102"}'::jsonb));
  o3 := sorteo_orden_registrar(v_emp, jsonb_build_object('sorteo_id', v_s, 'cantidad', 1, 'canal', 'whatsapp', 'estado', 'pendiente_pago',
    'comprador', '{"nombre": "PRUEBA Wa Tres", "documento": "6000003", "telefono": "595991000103"}'::jsonb));
  o4 := sorteo_orden_registrar(v_emp, jsonb_build_object('sorteo_id', v_s, 'cantidad', 1, 'canal', 'whatsapp', 'estado', 'pendiente_pago',
    'comprador', '{"nombre": "PRUEBA Wa Cuatro", "documento": "6000004", "telefono": "595991000104"}'::jsonb));
  perform pg_temp.ok('Sorteos WhatsApp: la compra del bot reserva los números con el combo',
    o1->>'estado' = 'pendiente_pago' and o1->>'canal' = 'whatsapp' and (o1->>'monto')::numeric = 25000 and jsonb_array_length(o1->'numeros') = 3, o1::text);

  -- Todo coincide: se confirma solo.
  v_lectura := jsonb_build_object('es_comprobante', true, 'monto', 25000, 'fecha', v_hoy, 'referencia', 'op 778899',
                                  'cuenta_destino', '****5678', 'titular_destino', 'RIFAS PRUEBA SA');
  v := sorteo_bot_comprobante(v_emp, (o1->>'id')::uuid, format('%s/%s/%s/a1b2.jpg', current_schema(), v_emp, o1->>'id'), v_lectura);
  perform pg_temp.ok('Sorteos WhatsApp: comprobante que coincide se confirma solo',
    v->>'resultado' = 'confirmada' and v->>'estado' = 'confirmada' and v->>'validacion' = 'auto' and v->>'referencia_pago' = 'OP778899', v::text);
  perform pg_temp.igual('Sorteos WhatsApp: sus números quedan vendidos',
    (select count(*) from sorteo_numeros where orden_id = (o1->>'id')::uuid and estado = 'vendido'), 3);

  -- La misma operación en otra compra: queda para revisar, avisando.
  v := sorteo_bot_comprobante(v_emp, (o2->>'id')::uuid, format('%s/%s/%s/c3d4.jpg', current_schema(), v_emp, o2->>'id'),
    v_lectura || '{"monto": 10000}');
  perform pg_temp.ok('Sorteos WhatsApp: un comprobante ya usado no confirma',
    v->>'resultado' = 'repetido' and v->>'estado' = 'en_revision' and v->>'referencia_pago' is null, v::text);

  -- Monto menor y cuenta de otro: revisión con los motivos.
  v := sorteo_bot_comprobante(v_emp, (o3->>'id')::uuid, format('%s/%s/%s/e5f6.png', current_schema(), v_emp, o3->>'id'),
    jsonb_build_object('es_comprobante', true, 'monto', 5000, 'fecha', v_hoy, 'referencia', '111222', 'cuenta_destino', '99990000', 'titular_destino', 'Otra persona'));
  perform pg_temp.ok('Sorteos WhatsApp: monto menor o cuenta ajena queda por revisar con el motivo',
    v->>'resultado' = 'revision' and v->>'estado' = 'en_revision'
    and exists (select 1 from jsonb_array_elements_text(v->'motivos') m where m like 'Monto leído%')
    and exists (select 1 from jsonb_array_elements_text(v->'motivos') m where m like 'La cuenta de destino%'), v::text);

  -- Sin lectura (no hay lector configurado): revisión manual, el comprobante queda guardado.
  v := sorteo_bot_comprobante(v_emp, (o4->>'id')::uuid, format('%s/%s/%s/g7h8.jpg', current_schema(), v_emp, o4->>'id'), null);
  perform pg_temp.ok('Sorteos WhatsApp: sin lectura queda por revisar', v->>'resultado' = 'revision' and v->>'comprobante_path' like '%g7h8.jpg', v::text);
  perform pg_temp.rechaza('Sorteos WhatsApp: el archivo tiene que estar en la carpeta de la compra',
    format($q$select sorteo_bot_comprobante(%L, %L, 'otra/x.jpg', null)$q$, v_emp, o4->>'id'), 'Archivo inválido');

  v := sorteo_bot_mis_compras(v_emp, '595991000101');
  perform pg_temp.ok('Sorteos WhatsApp: "mis números" devuelve las compras del teléfono',
    jsonb_array_length(v) = 1 and v->0->>'id' = o1->>'id', v::text);
  execute 'set local role authenticated';

  -- Sin confirmación automática, ni el comprobante perfecto confirma solo.
  perform sorteo_guardar(jsonb_build_object('id', v_s, 'nombre', 'PRUEBA Sorteo WhatsApp', 'precio', 10000, 'confirmacion_auto', false));
  execute 'set local role service_role';
  o2 := sorteo_orden_registrar(v_emp, jsonb_build_object('sorteo_id', v_s, 'cantidad', 1, 'canal', 'whatsapp', 'estado', 'pendiente_pago',
    'comprador', '{"nombre": "PRUEBA Wa Cinco", "documento": "6000005", "telefono": "595991000105"}'::jsonb));
  v := sorteo_bot_comprobante(v_emp, (o2->>'id')::uuid, format('%s/%s/%s/i9j0.jpg', current_schema(), v_emp, o2->>'id'),
    v_lectura || '{"monto": 10000, "referencia": "555666"}');
  execute 'set local role authenticated';
  perform pg_temp.ok('Sorteos WhatsApp: si el sorteo no confirma solo, queda por revisar',
    v->>'resultado' = 'revision' and exists (select 1 from jsonb_array_elements_text(v->'motivos') m where m = 'El sorteo no confirma solo'), v::text);

  -- Link del vivo (receta 127): se guarda, se ve en la página pública y se valida.
  v := sorteo_vivo_guardar(v_s, 'https://www.facebook.com/rifas/videos/123');
  perform pg_temp.ok('Sorteos vivo: se guarda el link del vivo', v->>'vivo_url' = 'https://www.facebook.com/rifas/videos/123', v::text);
  v_lectura := jsonb_build_object('slug', v->>'slug');
  execute 'set local role anon';
  v := sorteo_publico(v_lectura->>'slug');
  execute 'set local role authenticated';
  perform pg_temp.ok('Sorteos vivo: la página pública muestra el link del vivo', v->>'vivo_url' = 'https://www.facebook.com/rifas/videos/123', v::text);
  perform pg_temp.rechaza('Sorteos vivo: un link que no es web no se guarda', format($q$select sorteo_vivo_guardar(%L, 'mi vivo del sábado')$q$, v_s), 'link completo');

  -- Seguridad.
  perform pg_temp.rechaza('Sorteos WhatsApp: un usuario no carga comprobantes del bot',
    format($q$select sorteo_bot_comprobante(%L, %L, 'x', null)$q$, v_emp, o2->>'id'), 'permission denied');
  perform pg_temp.rechaza('Sorteos WhatsApp: nadie lee las sesiones del bot directo', $q$select * from sorteo_bot_sesiones$q$, 'permission denied');
  perform pg_temp.como('cajero');
  perform pg_temp.rechaza('Sorteos WhatsApp: el cajero no configura el bot', $q$select sorteo_bot_config_guardar('{"activo": false}')$q$, 'permiso');
  perform pg_temp.como('admin');
exception when others then
  execute 'set local role authenticated';
  perform pg_temp.como('admin');
  perform pg_temp.ok('Sorteos WhatsApp: el escenario se cortó', false, sqlerrm);
end $$;
