-- =============================================================================
-- Autogeneración OPCIONAL de SKU y código de barras (botón "Generar" en el producto).
--   generar_sku(nombre)      → SKU legible armado desde el nombre (COC-COL-2L)
--   generar_codigo_barras()  → EAN-13 válido de USO INTERNO (prefijo 20)
-- Los números del código de barras salen de un contador por empresa (secuencias_producto) que se reserva al
-- pedirlo: dos personas creando productos a la vez nunca reciben el mismo. Si se genera
-- y no se guarda, ese número queda salteado (normal).
--
-- Por qué prefijo 20 y no 779: 779 es el prefijo de GS1 PARAGUAY (productos reales de
-- marcas paraguayas); un código inventado con 779 puede coincidir con uno real. GS1
-- reserva 20–29 para circulación restringida / uso interno de cada comercio.
-- SECURITY INVOKER + empresa_actual(). IDEMPOTENTE.
-- =============================================================================
create table if not exists :"schema".secuencias_producto (
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  clave text not null,
  valor bigint not null default 0,
  primary key (empresa_id, clave)
);
alter table :"schema".secuencias_producto enable row level security;
alter table :"schema".secuencias_producto force row level security;
drop policy if exists secuencias_propias on :"schema".secuencias_producto;
create policy secuencias_propias on :"schema".secuencias_producto to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update on :"schema".secuencias_producto to authenticated, service_role;

-- Reserva y devuelve el próximo valor de un contador, nunca por debajo de p_piso.
create or replace function :"schema".reservar_secuencia(p_clave text, p_piso bigint default 0)
returns bigint
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v bigint;
begin
  insert into secuencias_producto (empresa_id, clave, valor)
    values (empresa_actual(), p_clave, greatest(p_piso, 0) + 1)
  on conflict (empresa_id, clave)
    do update set valor = greatest(secuencias_producto.valor, p_piso) + 1
  returning valor into v;
  return v;
end;
$fn$;

-- Dígito verificador EAN-13 sobre los primeros 12 dígitos.
create or replace function :"schema".ean13_verificador(p_12 text)
returns text language sql immutable as $$
  select ((10 - (sum(substr(p_12, i, 1)::int * case when i % 2 = 1 then 1 else 3 end) % 10)) % 10)::text
    from generate_series(1, 12) i
$$;

create or replace function :"schema".generar_codigo_barras()
returns text
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_seq bigint;
  v_base text;
  v_codigo text;
begin
  if empresa_actual() is null then raise exception 'No hay empresa en la sesión'; end if;
  loop
    v_seq := reservar_secuencia('ean_interno');
    v_base := '20' || lpad((v_seq % 10000000000)::text, 10, '0');   -- 2 + 10 = 12 dígitos
    v_codigo := v_base || ean13_verificador(v_base);
    exit when not exists (select 1 from productos where empresa_id = empresa_actual() and codigo_barras = v_codigo);
  end loop;
  return v_codigo;
end;
$fn$;

-- SKU legible armado desde el NOMBRE (así se reconoce el producto mirando el código):
--   3 letras de las 2 primeras palabras + la medida si la trae (2L, 1KG, 500G).
--   "Coca-Cola 2L" → COC-COL-2L · "Pan lactal" → PAN-LAC · "Yerba Kurupí 1kg" → YER-KUR-1KG
-- Si ya existe: suma la 3ª palabra ("Coca-Cola 2L Zero" → COC-COL-2L-ZER) y si sigue
-- repetido, un número (COC-COL-2L-2). Sin tildes, mayúsculas, sin palabras de relleno.
drop function if exists :"schema".generar_sku();
create or replace function :"schema".generar_sku(p_nombre text)
returns text
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_txt text;
  v_tok text;
  v_letras text[] := '{}';
  v_medida text;
  v_base text;
  v_sku text;
  n int := 2;
begin
  if empresa_actual() is null then raise exception 'No hay empresa en la sesión'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Escribí primero el nombre del producto'; end if;

  v_txt := upper(translate(p_nombre, 'áéíóúàèìòùäëïöüâêîôûñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑÇ',
                                     'aeiouaeiouaeiouaeiouncAEIOUAEIOUAEIOUAEIOUNC'));
  -- "1,5 L" / "500 g" → "1.5L" / "500G" (la medida queda en un solo bloque)
  v_txt := regexp_replace(v_txt, '([0-9])[,.]([0-9])', '\1.\2', 'g');
  v_txt := regexp_replace(v_txt, '([0-9]) +(ML|CC|LTS?|L|KGS?|KG|GRS?|G|MM|CM|MTS?|M|UNID|UN|U)\M', '\1\2', 'g');

  for v_tok in select t from regexp_split_to_table(v_txt, '[^A-Z0-9.]+') t where t <> '' loop
    if v_tok ~ '[0-9]' then
      if v_medida is null then v_medida := left(v_tok, 8); end if;
    elsif length(v_tok) >= 2 and v_tok not in ('DE','DEL','LA','LAS','EL','LOS','CON','SIN','PARA','POR','Y','EN','AL') then
      v_letras := v_letras || left(replace(v_tok, '.', ''), 3);
    end if;
  end loop;

  v_base := array_to_string(v_letras[1:2], '-');
  if v_medida is not null then v_base := concat_ws('-', nullif(v_base, ''), v_medida); end if;
  if coalesce(v_base, '') = '' then v_base := 'PROD'; end if;

  v_sku := v_base;
  if exists (select 1 from productos where empresa_id = empresa_actual() and upper(sku) = v_sku)
     and array_length(v_letras, 1) >= 3 then
    v_sku := v_base || '-' || v_letras[3];
  end if;
  while exists (select 1 from productos where empresa_id = empresa_actual() and upper(sku) = v_sku) loop
    v_sku := v_base || '-' || n;
    n := n + 1;
  end loop;
  return v_sku;
end;
$fn$;

grant execute on function :"schema".reservar_secuencia(text, bigint) to authenticated, service_role;
grant execute on function :"schema".ean13_verificador(text) to authenticated, service_role;
grant execute on function :"schema".generar_codigo_barras() to authenticated, service_role;
grant execute on function :"schema".generar_sku(text) to authenticated, service_role;
