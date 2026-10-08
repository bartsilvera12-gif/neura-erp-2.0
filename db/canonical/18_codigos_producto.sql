-- =============================================================================
-- Autogeneración OPCIONAL de SKU y código de barras (botón "Generar" en el producto).
--   generar_sku()            → próximo SKU siguiendo el patrón que ya usa el cliente
--   generar_codigo_barras()  → EAN-13 válido de USO INTERNO (prefijo 20)
-- Los números salen de un contador por empresa (secuencias_producto) que se reserva al
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

create or replace function :"schema".generar_sku()
returns text
language plpgsql security invoker set search_path = :"schema", public as $fn$
declare
  v_prefijo text;
  v_ancho int;
  v_max bigint;
  v_seq bigint;
  v_sku text;
  v_numericos int;
  v_con_patron int;
begin
  if empresa_actual() is null then raise exception 'No hay empresa en la sesión'; end if;

  -- Patrón PREFIJO-NNNN más usado (ej. BEB-0012 → BEB, 4 dígitos).
  select upper(m[1]), max(length(m[2])), count(*)
    into v_prefijo, v_ancho, v_con_patron
    from (select regexp_match(sku, '^([A-Za-z]+)[-_]([0-9]+)$') m
            from productos where empresa_id = empresa_actual()) x
   where m is not null
   group by upper(m[1])
   order by count(*) desc, upper(m[1])
   limit 1;

  -- SKU numéricos puros (hasta 9 dígitos: excluye códigos de barras guardados como SKU).
  select count(*) into v_numericos from productos
   where empresa_id = empresa_actual() and sku ~ '^[0-9]{1,9}$';

  if v_numericos > coalesce(v_con_patron, 0) then
    select coalesce(max(sku::bigint), 0) into v_max from productos
     where empresa_id = empresa_actual() and sku ~ '^[0-9]{1,9}$';
    loop
      v_seq := reservar_secuencia('sku_numerico', v_max);
      v_sku := v_seq::text;
      exit when not exists (select 1 from productos where empresa_id = empresa_actual() and upper(sku) = v_sku);
    end loop;
    return v_sku;
  end if;

  v_prefijo := coalesce(v_prefijo, 'P');
  v_ancho := greatest(coalesce(v_ancho, 6), 4);
  select coalesce(max((regexp_match(sku, '^[A-Za-z]+[-_]([0-9]+)$'))[1]::bigint), 0) into v_max
    from productos
   where empresa_id = empresa_actual() and upper(sku) ~ ('^' || v_prefijo || '[-_][0-9]+$');
  loop
    v_seq := reservar_secuencia('sku:' || v_prefijo, v_max);
    v_sku := v_prefijo || '-' || lpad(v_seq::text, v_ancho, '0');
    exit when not exists (select 1 from productos where empresa_id = empresa_actual() and upper(sku) = v_sku);
  end loop;
  return v_sku;
end;
$fn$;

grant execute on function :"schema".reservar_secuencia(text, bigint) to authenticated, service_role;
grant execute on function :"schema".ean13_verificador(text) to authenticated, service_role;
grant execute on function :"schema".generar_codigo_barras() to authenticated, service_role;
grant execute on function :"schema".generar_sku() to authenticated, service_role;
