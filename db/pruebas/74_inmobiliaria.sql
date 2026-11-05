-- Inmobiliaria (receta 130): la función, los tipos de propiedad y la ficha de cada propiedad como producto.
do $$
declare
  v jsonb;
  p1 jsonb; p2 jsonb; p3 jsonb;
  v_dueno uuid;
  v_tipos jsonb;
  v_casa uuid;
  v_terreno uuid;
begin
  -- Rubro: el Administrador prende Inmobiliaria.
  v := guardar_funciones_empresa('{"inmobiliaria": true}');
  perform pg_temp.ok('Inmobiliaria: el administrador prende la función', (v->>'inmobiliaria')::boolean, v::text);

  v_tipos := propiedad_tipos_lista();
  perform pg_temp.ok('Inmobiliaria: arranca con los tipos de siempre', jsonb_array_length(v_tipos) >= 10, v_tipos::text);
  select (x->>'id')::uuid into v_casa from jsonb_array_elements(v_tipos) x where x->>'nombre' = 'Casa';
  select (x->>'id')::uuid into v_terreno from jsonb_array_elements(v_tipos) x where x->>'nombre' = 'Terreno / lote';

  -- Validaciones.
  perform pg_temp.rechaza('Inmobiliaria: venta sin precio no se guarda',
    $q$select propiedad_guardar('{"titulo": "PRUEBA Casa sin precio", "gestion": "venta"}')$q$, 'precio de venta');
  perform pg_temp.rechaza('Inmobiliaria: alquiler sin monto mensual no se guarda',
    $q$select propiedad_guardar('{"titulo": "PRUEBA Depto", "gestion": "alquiler"}')$q$, 'alquiler mensual');
  perform pg_temp.rechaza('Inmobiliaria: de un tercero pide el dueño',
    $q$select propiedad_guardar('{"titulo": "PRUEBA Ajena", "gestion": "venta", "precio_venta": 1000, "propia": false}')$q$, 'dueño');

  -- Propia, en venta.
  p1 := propiedad_guardar(jsonb_build_object('titulo', 'PRUEBA Casa 3 dormitorios en Luque', 'tipo_id', v_casa, 'gestion', 'venta',
    'precio_venta', 850000000, 'ciudad', 'Luque', 'barrio', 'Centro', 'direccion', 'Av. PRUEBA 123',
    'superficie_terreno', 360, 'superficie_construida', 180.5, 'cuenta_catastral', '27-1234-05', 'finca', '9876',
    'manzana', '12', 'lote', '7', 'documentacion', 'en_tramite', 'documentacion_nota', 'Falta la mensura'));
  perform pg_temp.ok('Inmobiliaria: nace con código INM y disponible', p1->>'codigo' ~ '^INM-\d{4}$' and p1->>'estado' = 'disponible', p1::text);
  perform pg_temp.ok('Inmobiliaria: guarda la ficha completa',
    (p1->>'superficie_construida')::numeric = 180.5 and p1->>'cuenta_catastral' = '27-1234-05' and p1->>'lote' = '7'
    and p1->>'documentacion' = 'en_tramite' and p1->>'tipo' = 'Casa', p1::text);
  perform pg_temp.ok('Inmobiliaria: es un producto sin stock, vendible, con IVA 5 %',
    exists (select 1 from productos where id = (p1->>'producto_id')::uuid and not controla_stock and es_vendible
             and tipo_iva = '5%' and sku = p1->>'codigo' and precio_venta = 850000000));

  -- De un tercero, solo alquiler: no se vende en la caja.
  insert into clientes (empresa_id, nombre, documento) values (pg_temp.fx('empresa'), 'PRUEBA Dueña Inmueble', 'PRUEBA-DUENA-1') returning id into v_dueno;
  p2 := propiedad_guardar(jsonb_build_object('titulo', 'PRUEBA Departamento en Asunción', 'gestion', 'alquiler', 'precio_alquiler', 3500000,
    'ciudad', 'Asunción', 'propia', false, 'propietario_id', v_dueno, 'comision_alquiler_pct', 8));
  perform pg_temp.ok('Inmobiliaria: de un tercero guarda el dueño y su comisión',
    not (p2->>'propia')::boolean and p2->>'propietario' = 'PRUEBA Dueña Inmueble' and (p2->>'comision_alquiler_pct')::numeric = 8, p2::text);
  perform pg_temp.ok('Inmobiliaria: solo alquiler no se vende en la caja',
    exists (select 1 from productos where id = (p2->>'producto_id')::uuid and not es_vendible));
  perform pg_temp.ok('Inmobiliaria: el código sigue la numeración', (p2->>'codigo') > (p1->>'codigo'), (p1->>'codigo') || ' / ' || (p2->>'codigo'));

  -- Venta y alquiler: aparece en los dos filtros.
  p3 := propiedad_guardar(jsonb_build_object('titulo', 'PRUEBA Lote en San Bernardino', 'tipo_id', v_terreno, 'gestion', 'venta_alquiler',
    'precio_venta', 120000000, 'precio_alquiler', 1500000, 'ciudad', 'San Bernardino', 'manzana', 'B', 'lote', '22'));
  v := propiedades_lista('{"gestion": "alquiler"}');
  perform pg_temp.ok('Inmobiliaria: el filtro alquiler incluye las de venta y alquiler',
    exists (select 1 from jsonb_array_elements(v->'items') x where x->>'id' = p3->>'id')
    and exists (select 1 from jsonb_array_elements(v->'items') x where x->>'id' = p2->>'id')
    and not exists (select 1 from jsonb_array_elements(v->'items') x where x->>'id' = p1->>'id'), v::text);
  v := propiedades_lista('{"q": "san bernardino 22"}');
  perform pg_temp.ok('Inmobiliaria: se busca por ciudad y lote, sin tildes ni orden', (v->>'total')::integer = 1 and v->'items'->0->>'id' = p3->>'id', v::text);
  v := propiedades_lista('{"ciudad": "asuncion"}');
  -- (la demo puede tener otras propiedades en Asunción: se mira solo las de la prueba)
  perform pg_temp.ok('Inmobiliaria: el filtro de ciudad ignora tildes',
    exists (select 1 from jsonb_array_elements(v->'items') x where x->>'id' = p2->>'id')
    and not exists (select 1 from jsonb_array_elements(v->'items') x where x->>'id' in (p1->>'id', p3->>'id')), v::text);

  -- Estado: vendida no se vuelve a vender en la caja.
  v := propiedad_estado((p1->>'id')::uuid, 'vendida');
  perform pg_temp.ok('Inmobiliaria: vendida deja de venderse en la caja', v->>'estado' = 'vendida'
    and exists (select 1 from productos where id = (p1->>'producto_id')::uuid and not es_vendible));
  v := propiedades_lista('{"estado": "disponible"}');
  perform pg_temp.ok('Inmobiliaria: la lista cuenta por estado', (v->'por_estado'->>'vendida')::integer >= 1
    and not exists (select 1 from jsonb_array_elements(v->'items') x where x->>'id' = p1->>'id'), v::text);

  -- Tipos: uno en uso no se borra, se desactiva.
  v := propiedad_tipos_guardar((select jsonb_agg(x) from jsonb_array_elements(propiedad_tipos_lista()) x where x->>'nombre' <> 'Casa')
                               || '[{"nombre": "PRUEBA Cochera"}]'::jsonb);
  perform pg_temp.ok('Inmobiliaria: un tipo en uso queda desactivado y uno nuevo se suma',
    exists (select 1 from jsonb_array_elements(v) x where x->>'nombre' = 'Casa' and not (x->>'activo')::boolean)
    and exists (select 1 from jsonb_array_elements(v) x where x->>'nombre' = 'PRUEBA Cochera'), v::text);

  -- Seguridad.
  perform pg_temp.rechaza('Inmobiliaria: nadie lee las propiedades directo', $q$select * from propiedades$q$, 'permission denied');
  perform pg_temp.rechaza('Inmobiliaria: sin sesión no se listan', $q$set local role anon; select propiedades_lista()$q$, 'permission denied');
  perform pg_temp.como('cajero');
  perform pg_temp.ok('Inmobiliaria: el cajero ve las propiedades', (propiedades_lista()->>'total')::integer >= 3);
  perform pg_temp.rechaza('Inmobiliaria: el cajero no carga propiedades',
    $q$select propiedad_guardar('{"titulo": "PRUEBA cajero", "gestion": "venta", "precio_venta": 1}')$q$, 'permiso');
  perform pg_temp.como('admin');

  -- Apagada, no se usa.
  perform guardar_funciones_empresa('{"inmobiliaria": false}');
  perform pg_temp.rechaza('Inmobiliaria: apagada no se listan las propiedades', $q$select propiedades_lista()$q$, 'no está activa');
exception when others then
  execute 'set local role authenticated';
  perform pg_temp.como('admin');
  perform pg_temp.ok('Inmobiliaria: el escenario se cortó', false, sqlerrm);
end $$;
