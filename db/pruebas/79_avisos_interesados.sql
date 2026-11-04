-- Avisos a interesados (receta 140): propiedad nueva o más barata → aviso pendiente + campanita.
-- Solo los del cliente de prueba (la demo puede tener otras búsquedas que también coinciden).
create function pg_temp.avisos_de(p_propiedad uuid, p_cliente uuid) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(propiedad_avisos_lista(p_propiedad)) x where (x->>'cliente_id')::uuid = p_cliente
$f$;

do $$
declare
  v jsonb;
  b jsonb;
  p1 jsonb; p2 jsonb;
  v_cli uuid;
  v_cli2 uuid;
  v_aviso uuid;
begin
  v := guardar_funciones_empresa('{"inmobiliaria": true}');
  insert into clientes (empresa_id, nombre, telefono) values (pg_temp.fx('empresa'), 'PRUEBA Busca en Avisolandia', '0981 111 222') returning id into v_cli;
  insert into clientes (empresa_id, nombre) values (pg_temp.fx('empresa'), 'PRUEBA Ya la conocía') returning id into v_cli2;
  b := cliente_busqueda_guardar(jsonb_build_object('cliente_id', v_cli, 'gestion', 'venta', 'ciudad', 'PRUEBA Avisolandia', 'precio_max', 500000000));

  -- Entra una que le sirve: aviso pendiente y notificación para quien cargó la búsqueda.
  p1 := propiedad_guardar(jsonb_build_object('titulo', 'PRUEBA Casa en Avisolandia', 'gestion', 'venta', 'precio_venta', 400000000, 'ciudad', 'PRUEBA Avisolandia'));
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  v := pg_temp.avisos_de((p1->>'id')::uuid, v_cli);
  perform pg_temp.ok('Avisos: la propiedad nueva genera un aviso pendiente para el interesado',
    jsonb_array_length(v) = 1 and v->0->>'estado' = 'pendiente' and (v->0->>'cliente_id')::uuid = v_cli and v->0->>'telefono' = '0981 111 222', v::text);
  v_aviso := (v->0->>'id')::uuid;
  perform pg_temp.ok('Avisos: llega a la campanita de quien cargó la búsqueda',
    exists (select 1 from usuario_notificaciones where tipo = 'inmo_interesados' and url = '/inmobiliaria?propiedad=' || (p1->>'id')));
  perform pg_temp.ok('Avisos: aparece en los pendientes de la empresa',
    exists (select 1 from jsonb_array_elements(propiedad_avisos_lista()) x where (x->>'id')::uuid = v_aviso));

  -- Guardarla otra vez no repite el aviso.
  perform propiedad_guardar(jsonb_build_object('id', p1->>'id', 'titulo', 'PRUEBA Casa en Avisolandia', 'gestion', 'venta', 'precio_venta', 390000000, 'ciudad', 'PRUEBA Avisolandia'));
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  perform pg_temp.igual('Avisos: no se repite al volver a guardar', jsonb_array_length(pg_temp.avisos_de((p1->>'id')::uuid, v_cli))::numeric, 1);

  -- Avisado por WhatsApp: queda enviado y la campanita se limpia.
  v := propiedad_aviso_resolver(v_aviso, 'enviado', 'whatsapp');
  -- (los datos de demo pueden tener otros interesados: se descartan para ver que la campanita se limpia)
  perform propiedad_aviso_resolver((x->>'id')::uuid, 'descartado')
     from jsonb_array_elements(propiedad_avisos_lista((p1->>'id')::uuid)) x where x->>'estado' = 'pendiente';
  perform pg_temp.ok('Avisos: queda enviado por WhatsApp', v->>'estado' = 'enviado' and v->>'canal' = 'whatsapp', v::text);
  perform pg_temp.ok('Avisos: sin pendientes se borra la notificación',
    not exists (select 1 from usuario_notificaciones where tipo = 'inmo_interesados' and url = '/inmobiliaria?propiedad=' || (p1->>'id')));
  perform pg_temp.rechaza('Avisos: enviado necesita por dónde', format('select propiedad_aviso_resolver(%L, %L)', v_aviso, 'enviado'), 'por dónde');

  -- Una cara no avisa; al bajar el precio, sí.
  p2 := propiedad_guardar(jsonb_build_object('titulo', 'PRUEBA Casa cara en Avisolandia', 'gestion', 'venta', 'precio_venta', 700000000, 'ciudad', 'PRUEBA Avisolandia'));
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  perform pg_temp.igual('Avisos: la cara no le sirve', jsonb_array_length(pg_temp.avisos_de((p2->>'id')::uuid, v_cli))::numeric, 0);
  perform propiedad_guardar(jsonb_build_object('id', p2->>'id', 'titulo', 'PRUEBA Casa cara en Avisolandia', 'gestion', 'venta', 'precio_venta', 450000000, 'ciudad', 'PRUEBA Avisolandia'));
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  v := pg_temp.avisos_de((p2->>'id')::uuid, v_cli);
  perform pg_temp.ok('Avisos: al bajar el precio le avisa', jsonb_array_length(v) = 1 and v->0->>'estado' = 'pendiente', v::text);
  v := propiedad_aviso_resolver((v->0->>'id')::uuid, 'descartado');
  perform pg_temp.ok('Avisos: se puede descartar', v->>'estado' = 'descartado', v::text);

  -- Quien carga una búsqueda ya ve lo que hay: eso no se avisa.
  perform cliente_busqueda_guardar(jsonb_build_object('cliente_id', v_cli2, 'gestion', 'venta', 'ciudad', 'PRUEBA Avisolandia'));
  perform pg_temp.ok('Avisos: lo que ya coincidía al cargar la búsqueda no queda pendiente',
    not exists (select 1 from jsonb_array_elements(propiedad_avisos_lista()) x where (x->>'cliente_id')::uuid = v_cli2));
  perform pg_temp.rechaza('Avisos: nadie los lee directo', $q$select * from propiedad_avisos$q$, 'permission denied');
  perform guardar_funciones_empresa('{"inmobiliaria": false}');
exception when others then
  execute 'set local role authenticated';
  perform pg_temp.como('admin');
  perform pg_temp.ok('Avisos a interesados: el escenario se cortó', false, sqlerrm);
end $$;
