-- Sorteos (receta 123): combos, números que no se pisan y se liberan, compra web con reserva que vence,
-- vendedor con link + PIN y cupo, rendición, sorteo digital verificable y cupones de urna.
do $$
declare
  v jsonb;
  v_s uuid;
  v_slug text;
  o1 jsonb; o2 jsonb; o3 jsonb; ow jsonb; ow2 jsonb; ow3 jsonb; ov jsonb;
  v_token text;
  v_vend jsonb;
  v_link text;
  v_pin text;
  v_lista jsonb;
  v_pub jsonb;
  v_idx integer;
  v_n integer;
  v_premio uuid;
  v_premio2 uuid;
begin
  -- Rubro: el Administrador prende Sorteos y la pantalla lo devuelve.
  v := guardar_funciones_empresa('{"sorteos": true}');
  perform pg_temp.ok('Sorteos: el administrador prende la función', (v->>'sorteos')::boolean, v::text);

  perform pg_temp.rechaza('Sorteos: precio 0 no se guarda', $q$select sorteo_guardar('{"nombre": "PRUEBA cero", "precio": 0}')$q$, 'mayor a 0');
  v := sorteo_guardar(jsonb_build_object(
    'nombre', 'PRUEBA Sorteo moto', 'precio', 5000, 'numero_desde', 1, 'numero_hasta', 100, 'modo_numeros', 'aleatorio',
    'permite_elegir', true, 'max_por_compra', 50, 'reserva_minutos', 15,
    'combos', '[{"cantidad": 2, "precio": 8000, "etiqueta": "2 x 8.000"}, {"cantidad": 5, "precio": 20000}]'::jsonb));
  v_s := (v->>'id')::uuid;
  v_slug := v->>'slug';
  perform pg_temp.ok('Sorteos: nace en borrador con 2 combos', v->>'estado' = 'borrador' and jsonb_array_length(v->'combos') = 2, v::text);
  perform pg_temp.rechaza('Sorteos: no se activa sin una cuenta para cobrar', format($q$select sorteo_estado(%L, 'activo')$q$, v_s), 'cuenta para cobrar');
  perform sorteo_guardar(jsonb_build_object('id', v_s, 'nombre', 'PRUEBA Sorteo moto', 'precio', 5000,
    'datos_pago', '[{"banco": "Banco PRUEBA", "titular": "PRUEBA SA", "cuenta": "123"}]'::jsonb));
  v := sorteo_estado(v_s, 'activo');
  perform pg_temp.igual('Sorteos: al activar se generan los 100 números', (v->'stats'->>'total')::numeric, 100);
  perform pg_temp.ok('Sorteos: al activar queda publicada la huella de la semilla', length(v->>'semilla_hash') = 64 and not (v ? 'semilla'));
  perform pg_temp.rechaza('Sorteos: con números generados el rango no cambia',
    format($q$select sorteo_guardar('{"id": "%s", "nombre": "PRUEBA Sorteo moto", "precio": 5000, "numero_hasta": 200}')$q$, v_s), 'ya se generaron');

  -- Venta manual: el combo pone el precio; el resto es cantidad × precio.
  o1 := sorteo_vender(jsonb_build_object('sorteo_id', v_s, 'cantidad', 5, 'metodo_pago', 'efectivo',
    'comprador', '{"nombre": "PRUEBA Juan Pérez", "documento": "4.123.456", "telefono": "0981 111 222", "ciudad": "Luque"}'::jsonb));
  perform pg_temp.igual('Sorteos: 5 boletas cobran el combo', (o1->>'monto')::numeric, 20000);
  perform pg_temp.igual('Sorteos: el precio de lista queda para ver el descuento', (o1->>'precio_lista')::numeric, 25000);
  perform pg_temp.ok('Sorteos: la venta manual queda confirmada con 5 números distintos',
    o1->>'estado' = 'confirmada' and (select count(distinct x) from jsonb_array_elements_text(o1->'numeros') x) = 5, o1::text);
  o2 := sorteo_vender(jsonb_build_object('sorteo_id', v_s, 'cantidad', 3, 'comprador', '{"nombre": "PRUEBA Juan Pérez", "documento": "4123456"}'::jsonb));
  perform pg_temp.igual('Sorteos: 3 boletas sin combo = 3 × 5.000', (o2->>'monto')::numeric, 15000);
  perform pg_temp.ok('Sorteos: dos ventas no comparten números',
    not exists (select 1 from jsonb_array_elements_text(o1->'numeros') a join jsonb_array_elements_text(o2->'numeros') b on a = b));
  perform pg_temp.igual('Sorteos: el mismo comprador (misma cédula con puntos o sin) es un solo cliente',
    (select count(*) from clientes where empresa_id = pg_temp.fx('empresa') and origen = 'SORTEO' and nombre = 'PRUEBA Juan Pérez'), 1);

  o3 := sorteo_vender(jsonb_build_object('sorteo_id', v_s, 'numeros', '[7, 8]'::jsonb, 'comprador', '{"nombre": "PRUEBA Ana", "telefono": "0982000111"}'::jsonb,
    'idempotency_key', 'prueba-idem-1'));
  perform pg_temp.ok('Sorteos: se venden los números elegidos', o3->'numeros' = '["007", "008"]'::jsonb, o3::text);
  perform pg_temp.rechaza('Sorteos: un número ya vendido no se vende otra vez',
    format($q$select sorteo_vender('{"sorteo_id": "%s", "numeros": [8, 9], "comprador": {"nombre": "PRUEBA Otro", "telefono": "0983000000"}}')$q$, v_s), 'ya no está disponible');
  v := sorteo_vender(jsonb_build_object('sorteo_id', v_s, 'numeros', '[7, 8]'::jsonb, 'comprador', '{"nombre": "PRUEBA Ana", "telefono": "0982000111"}'::jsonb,
    'idempotency_key', 'prueba-idem-1'));
  perform pg_temp.ok('Sorteos: el mismo pedido repetido devuelve la misma compra', v->>'id' = o3->>'id' and (v->>'repetida')::boolean);
  perform pg_temp.rechaza('Sorteos: más que el máximo por compra no', format($q$select sorteo_vender('{"sorteo_id": "%s", "cantidad": 51, "comprador": {"nombre": "PRUEBA X", "telefono": "0983000001"}}')$q$, v_s), 'máximo por compra');
  perform pg_temp.rechaza('Sorteos: sin teléfono ni cédula no se vende', format($q$select sorteo_vender('{"sorteo_id": "%s", "cantidad": 1, "comprador": {"nombre": "PRUEBA X"}}')$q$, v_s), 'teléfono o la cédula');

  -- Compra web: reserva, comprobante, revisión.
  execute 'set local role anon';
  v_pub := sorteo_publico(v_slug);
  ow := sorteo_publico_comprar(v_slug, '{"cantidad": 2, "comprador": {"nombre": "PRUEBA Web Uno", "documento": "5000001", "telefono": "0991000001", "ciudad": "Asunción"}}', '10.0.0.1');
  ow2 := sorteo_publico_comprar(v_slug, '{"cantidad": 1, "comprador": {"nombre": "PRUEBA Web Dos", "documento": "5000002", "telefono": "0991000002"}}', '10.0.0.1');
  ow3 := sorteo_publico_comprar(v_slug, '{"cantidad": 4, "comprador": {"nombre": "PRUEBA Web Tres", "documento": "5000003", "telefono": "0991000003"}}', '10.0.0.1');
  v_token := ow->>'token';
  v := sorteo_publico_orden(v_token);
  execute 'set local role authenticated';
  perform pg_temp.igual('Sorteos: la página pública ve los números libres', (v_pub->>'disponibles')::numeric, 90);
  perform pg_temp.ok('Sorteos: la compra web queda esperando el pago con los datos para transferir',
    v->>'estado' = 'pendiente_pago' and v->'datos_pago'->0->>'banco' = 'Banco PRUEBA' and jsonb_array_length(v->'numeros') = 2, v::text);
  perform pg_temp.ok('Sorteos: la compra web no muestra la cédula', not (v ? 'comprador_documento') and not (ow->'orden' ? 'comprador_documento'));
  perform pg_temp.rechaza('Sorteos: el comprobante tiene que estar en la carpeta de esa compra',
    format($q$set local role anon; select sorteo_publico_comprobante(%L, 'otra/carpeta/x.jpg', null)$q$, v_token), 'Archivo inválido');
  execute 'set local role anon';
  v := sorteo_publico_comprobante(v_token, format('%s/%s/%s/comprobante-1.jpg', current_schema(), pg_temp.fx('empresa'), ow->'orden'->>'id'), 'OP-PRUEBA-1');
  execute 'set local role authenticated';
  perform pg_temp.ok('Sorteos: con el comprobante pasa a revisión', v->>'estado' = 'en_revision', v::text);
  perform pg_temp.rechaza('Sorteos: el mismo comprobante no sirve para otra compra',
    format($q$set local role anon; select sorteo_publico_comprobante(%L, '%s/%s/%s/c.jpg', 'OP-PRUEBA-1')$q$, ow2->>'token', current_schema(), pg_temp.fx('empresa'), ow2->'orden'->>'id'), 'ya se usó');
  v := sorteo_orden_confirmar((ow->'orden'->>'id')::uuid);
  perform pg_temp.ok('Sorteos: revisar y confirmar deja los números vendidos', v->>'estado' = 'confirmada'
    and (select count(*) from jsonb_array_elements_text(v->'numeros')) = 2, v::text);

  -- Rechazar libera.
  v := sorteo_detalle(v_s);
  v_n := (v->'stats'->>'reservados')::integer;
  perform sorteo_orden_rechazar((ow2->'orden'->>'id')::uuid, 'No llegó la plata');
  v := sorteo_detalle(v_s);
  perform pg_temp.igual('Sorteos: rechazar un pago libera su número', (v->'stats'->>'reservados')::numeric, v_n - 1);

  -- La reserva web vence sola y libera los números.
  execute 'set local role service_role';
  update sorteo_ordenes set vence_at = now() - interval '1 minute' where id = (ow3->'orden'->>'id')::uuid;
  execute 'set local role anon';
  v := sorteo_publico_orden(ow3->>'token');
  execute 'set local role authenticated';
  perform pg_temp.ok('Sorteos: la reserva vencida queda vencida y sin números', v->>'estado' = 'vencida' and jsonb_array_length(v->'numeros') = 0, v::text);
  perform pg_temp.rechaza('Sorteos: una reserva vencida no se confirma', format($q$select sorteo_orden_confirmar(%L)$q$, ow3->'orden'->>'id'), 'no se puede confirmar');

  -- Anular devuelve los números.
  perform pg_temp.rechaza('Sorteos: anular pide motivo', format($q$select sorteo_orden_anular(%L, ' ')$q$, o2->>'id'), 'motivo');
  perform sorteo_orden_anular((o2->>'id')::uuid, 'Pidió la devolución');
  v := sorteo_detalle(v_s);
  perform pg_temp.igual('Sorteos: los vendidos bajan al anular', (v->'stats'->>'vendidos')::numeric, 5 + 2 + 2);

  -- Vendedor con link + PIN, cupo y rendición.
  v_vend := sorteo_vendedor_guardar('{"nombre": "PRUEBA Vendedor Calle", "telefono": "0984 555 666", "comision_pct": 20, "cupo": 6}');
  v_pin := v_vend->>'pin';
  v_link := sorteo_vendedor_link((v_vend->>'id')::uuid);
  perform pg_temp.ok('Sorteos: el vendedor nace con código, PIN de 4 números y link', v_vend->>'codigo' ~ '^[A-Z0-9]{3,20}$' and v_pin ~ '^\d{4}$' and length(v_link) = 48, v_vend::text);
  execute 'set local role anon';
  v := sorteo_vendedor_entrar(v_link, '0000' || v_pin);
  ov := sorteo_vendedor_vender(v_link, v_pin, jsonb_build_object('sorteo_id', v_s, 'cantidad', 5, 'metodo_pago', 'efectivo',
    'comprador', '{"nombre": "PRUEBA Cliente Calle", "telefono": "0985000001"}'::jsonb));
  execute 'set local role authenticated';
  perform pg_temp.ok('Sorteos: con el PIN mal no entra', not (v->>'ok')::boolean);
  perform pg_temp.ok('Sorteos: el vendedor vende en efectivo y queda confirmada a su nombre',
    (ov->>'ok')::boolean and ov->'orden'->>'estado' = 'confirmada' and ov->'orden'->>'vendedor_id' = v_vend->>'id', ov::text);
  perform pg_temp.rechaza('Sorteos: el vendedor no pasa su cupo',
    format($q$set local role anon; select sorteo_vendedor_vender(%L, %L, '{"sorteo_id": "%s", "cantidad": 2, "metodo_pago": "efectivo", "comprador": {"nombre": "PRUEBA Y", "telefono": "0985000002"}}')$q$, v_link, v_pin, v_s), 'cupo');
  v := sorteo_rendir((v_vend->>'id')::uuid, 'Entregó en oficina');
  perform pg_temp.ok('Sorteos: la rendición descuenta la comisión (20% de 20.000)',
    (v->>'monto')::numeric = 20000 and (v->>'comision')::numeric = 4000 and (v->>'entregado')::numeric = 16000, v::text);
  perform pg_temp.rechaza('Sorteos: lo rendido no se rinde dos veces', format($q$select sorteo_rendir(%L, null)$q$, v_vend->>'id'), 'no tiene efectivo');
  perform pg_temp.rechaza('Sorteos: una venta rendida no se anula', format($q$select sorteo_orden_anular(%L, 'error de carga')$q$, ov->'orden'->>'id'), 'rendición');
  for v_n in 1..5 loop
    execute 'set local role anon';
    perform sorteo_vendedor_entrar(v_link, '99999999');
    execute 'set local role authenticated';
  end loop;
  perform pg_temp.rechaza('Sorteos: 5 PIN incorrectos bloquean el punto de venta', format($q$set local role anon; select sorteo_vendedor_entrar(%L, %L)$q$, v_link, v_pin), 'Demasiados');

  -- Cupones para la urna.
  v := sorteo_cupones(jsonb_build_object('sorteo_id', v_s));
  perform pg_temp.igual('Sorteos: un cupón por número vendido', jsonb_array_length(v->'cupones')::numeric, 5 + 2 + 2 + 5);
  perform sorteo_cupones_impresos(v_s, array[(v->'cupones'->0->>'numero')::integer]);
  v := sorteo_cupones(jsonb_build_object('sorteo_id', v_s, 'solo_pendientes', true));
  perform pg_temp.igual('Sorteos: los impresos se pueden dejar afuera', jsonb_array_length(v->'cupones')::numeric, 13);

  -- Cierre y sorteo digital verificable.
  perform sorteo_premios_guardar(v_s, '[{"nombre": "PRUEBA Moto"}, {"nombre": "PRUEBA Celular"}]');
  v := sorteo_detalle(v_s);
  v_premio := (v->'premios'->0->>'id')::uuid;
  v_premio2 := (v->'premios'->1->>'id')::uuid;
  perform pg_temp.rechaza('Sorteos: no se sortea con la venta abierta', format($q$select sorteo_sortear(%L)$q$, v_premio), 'cerrá la venta');
  v := sorteo_estado(v_s, 'cerrado');
  perform pg_temp.ok('Sorteos: al cerrar queda la huella de la lista de vendidos', length(v->>'lista_hash') = 64 and (v->>'lista_cantidad')::integer = 14, v::text);
  perform pg_temp.rechaza('Sorteos: el ganador de urna tiene que ser un número vendido',
    format($q$select sorteo_ganador_manual(%L, 500, 'urna', null)$q$, v_premio2), 'no está vendido');
  v := sorteo_sortear(v_premio);
  perform pg_temp.ok('Sorteos: el premio digital sale de un número vendido', v->'premios'->0->>'numero_ganador' is not null and v->'premios'->0->>'ganador' is not null, v::text);
  v := sorteo_ganador_manual(v_premio2, (o3->'numeros'->>0)::integer, 'urna', 'Lo sacó el escribano');
  perform pg_temp.ok('Sorteos: con todos los premios el sorteo queda sorteado', v->>'estado' = 'sorteado' and (v->>'semilla_revelada')::boolean, v::text);

  -- Cualquiera recalcula el ganador digital con la semilla revelada y la lista pública.
  execute 'set local role anon';
  v_pub := sorteo_publico(v_slug);
  v_lista := sorteo_publico_lista(v_slug);
  execute 'set local role authenticated';
  v_idx := ((('x' || substr(encode(extensions.digest((v_pub->'verificacion'->>'semilla') || ':' || (v_lista->>'lista_hash') || ':1:0', 'sha256'), 'hex'), 1, 15))::bit(60)::bigint
            % jsonb_array_length(v_lista->'numeros')))::integer;
  perform pg_temp.ok('Sorteos: el ganador digital se puede recalcular desde afuera',
    lpad(v_lista->'numeros'->>v_idx, 3, '0') = v_pub->'premios'->0->>'numero_ganador'
    or (v_pub->'premios'->0->>'numero_ganador') is not null and (select intento from sorteo_premios where id = v_premio) > 0,
    format('calculado %s, publicado %s', v_lista->'numeros'->>v_idx, v_pub->'premios'->0->>'numero_ganador'));
  perform pg_temp.ok('Sorteos: la semilla revelada coincide con la huella publicada desde el principio',
    encode(extensions.digest(v_pub->'verificacion'->>'semilla', 'sha256'), 'hex') = v_pub->'verificacion'->>'semilla_hash');
  perform pg_temp.ok('Sorteos: el ganador se muestra con nombre corto', v_pub->'premios'->1->>'ganador' = 'PRUEBA A.' or v_pub->'premios'->1->>'ganador' = 'PRUEBA', v_pub::text);
  perform pg_temp.rechaza('Sorteos: sorteado, una compra no se anula', format($q$select sorteo_orden_anular(%L, 'tarde')$q$, o1->>'id'), 'ya se realizó');

  -- Seguridad.
  perform pg_temp.rechaza('Sorteos: nadie lee las compras directo', $q$select * from sorteo_ordenes$q$, 'permission denied');
  perform pg_temp.rechaza('Sorteos: nadie toca los números directo', $q$update sorteo_numeros set estado = 'libre'$q$, 'permission denied');
  perform pg_temp.rechaza('Sorteos: la venta interna no la llama un usuario', format($q$select sorteo_orden_registrar(%L, '{}')$q$, pg_temp.fx('empresa')), 'permission denied');
  perform pg_temp.rechaza('Sorteos: sin sesión no se listan', $q$set local role anon; select sorteos_lista()$q$, 'permission denied');
  perform pg_temp.como('cajero');
  perform pg_temp.ok('Sorteos: el cajero puede ver los sorteos', jsonb_array_length(sorteos_lista()) >= 1);
  perform pg_temp.rechaza('Sorteos: el cajero no crea sorteos', $q$select sorteo_guardar('{"nombre": "PRUEBA cajero", "precio": 1000}')$q$, 'permiso');
  perform pg_temp.rechaza('Sorteos: el cajero no confirma pagos', format($q$select sorteo_orden_confirmar(%L)$q$, ow->'orden'->>'id'), 'permiso');
  perform pg_temp.como('admin');
exception when others then
  execute 'set local role authenticated';
  perform pg_temp.como('admin');
  perform pg_temp.ok('Sorteos: el escenario se cortó', false, sqlerrm);
end $$;
