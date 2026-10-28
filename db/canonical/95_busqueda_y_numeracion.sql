-- =============================================================================
-- 95 · Rendimiento: búsqueda omnicanal con errores de tipeo + numeración de ventas O(1).
--
-- B. NUMERACIÓN DE VENTAS (siguiente_numero_venta, de la 61)
--    Antes: cada venta (crear_venta, emitir_factura_contado, emitir_cuota_suscripcion) y
--    cada apertura de Configuración › Facturación (config_facturacion → proximo_numero)
--    recorría TODAS las ventas de la empresa buscando el mayor "<prefijo>NNNNNN".
--    Ahora: tabla ventas_numeracion (empresa, prefijo) → mayor número usado con ese prefijo,
--    mantenida por un trigger de ventas (alta, cambio de número, borrado, truncate) en la
--    MISMA transacción de la venta. siguiente_numero_venta solo LEE ese valor (O(1)):
--      · misma semántica: greatest(mayor + 1, numeración inicial), prefijo + 6 dígitos;
--        una venta revertida (rollback) no consume número (el contador se revierte con
--        ella) y una anulada sí lo conserva (sigue en ventas), igual que antes;
--      · cambio de prefijo: la fila del prefijo nuevo se inicializa una vez desde las
--        ventas existentes (trigger de facturacion_config); si faltara, la función
--        vuelve a contar como antes (mismo resultado);
--      · concurrencia: igual que antes, quien emite toma pg_advisory_xact_lock
--        ('ventas_numero_<empresa>') antes de pedir el número; el trigger además bloquea
--        la fila del contador hasta el commit;
--      · la vista previa (config_facturacion) no reserva ni incrementa nada.
--
-- A. BÚSQUEDA OMNICANAL (chat_bandeja / chat_finalizadas, de la 87)
--    (ver la sección A más abajo)
--
-- IDEMPOTENTE. Va después de la 87 y la 92.
-- =============================================================================

set search_path to :"schema", public, extensions;

-- ═════════════════════════════════════════════════════════════════════════════
-- B. Numeración de ventas
-- ═════════════════════════════════════════════════════════════════════════════

-- Número (sin prefijo) de un numero_control si tiene ese prefijo y el resto son 1..18
-- dígitos; si no, null. Mismo criterio que la 61.
create or replace function :"schema".venta_numero_sufijo(p_numero text, p_prefijo text)
returns bigint language sql immutable parallel safe as $$
  select case when left(p_numero, length(p_prefijo)) = p_prefijo
               and substring(p_numero from length(p_prefijo) + 1) ~ '^[0-9]{1,18}$'
              then substring(p_numero from length(p_prefijo) + 1)::bigint end
$$;

-- Mayor número usado con un prefijo, contando las ventas (lo que hacía la 61). Solo para
-- inicializar / recalcular el contador.
create or replace function :"schema".venta_numeracion_contar(p_empresa uuid, p_prefijo text)
returns bigint language sql stable set search_path = :"schema", public as $$
  select coalesce(max(venta_numero_sufijo(v.numero_control, p_prefijo)), 0)
    from ventas v
   where v.empresa_id = p_empresa
     and left(v.numero_control, length(p_prefijo)) = p_prefijo
     and substring(v.numero_control from length(p_prefijo) + 1) ~ '^[0-9]{1,18}$'
$$;

create table if not exists :"schema".ventas_numeracion (
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  prefijo text not null,
  ultimo bigint not null default 0,            -- mayor número usado con este prefijo (0 = ninguno)
  updated_at timestamptz not null default now(),
  primary key (empresa_id, prefijo)
);
alter table :"schema".ventas_numeracion enable row level security;
drop policy if exists ventas_numeracion_propias on :"schema".ventas_numeracion;
create policy ventas_numeracion_propias on :"schema".ventas_numeracion
  for select to authenticated using (empresa_id = :"schema".empresa_actual());
-- Solo lectura desde la app (siguiente_numero_venta es SECURITY INVOKER); lo escribe el trigger.
revoke all on :"schema".ventas_numeracion from public, anon, authenticated;
grant select on :"schema".ventas_numeracion to authenticated;
grant all on :"schema".ventas_numeracion to service_role;

-- Asegura la fila (empresa, prefijo); la primera vez cuenta las ventas.
create or replace function :"schema".venta_numeracion_asegurar(p_empresa uuid, p_prefijo text)
returns void language plpgsql volatile security definer set search_path = :"schema", public as $fn$
begin
  if p_empresa is null or p_prefijo is null then return; end if;
  if not exists (select 1 from ventas_numeracion n where n.empresa_id = p_empresa and n.prefijo = p_prefijo) then
    insert into ventas_numeracion (empresa_id, prefijo, ultimo)
    values (p_empresa, p_prefijo, venta_numeracion_contar(p_empresa, p_prefijo))
    on conflict (empresa_id, prefijo) do nothing;
  end if;
end;
$fn$;
revoke execute on function :"schema".venta_numeracion_asegurar(uuid, text) from public, anon, authenticated;

create or replace function :"schema".tg_ventas_numeracion()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  r record;
begin
  if tg_op = 'TRUNCATE' then
    delete from ventas_numeracion;
    return null;
  end if;

  -- Sale un número (borrado o cambio): si era el mayor de su prefijo, se recalcula. Primero
  -- se bloquea la fila y recién después se cuenta (foto nueva: ve lo ya confirmado).
  if tg_op in ('UPDATE', 'DELETE') and old.numero_control is not null then
    for r in
      select n.prefijo, n.ultimo from ventas_numeracion n
       where n.empresa_id = old.empresa_id
         and venta_numero_sufijo(old.numero_control, n.prefijo) >= n.ultimo
         and (tg_op = 'DELETE' or old.numero_control is distinct from new.numero_control
              or old.empresa_id is distinct from new.empresa_id)
       for update
    loop
      update ventas_numeracion n set ultimo = venta_numeracion_contar(old.empresa_id, r.prefijo), updated_at = now()
       where n.empresa_id = old.empresa_id and n.prefijo = r.prefijo;
    end loop;
  end if;

  -- Entra un número (alta o cambio): sube el mayor de cada prefijo que lo contiene.
  if tg_op in ('INSERT', 'UPDATE') and new.numero_control is not null then
    perform venta_numeracion_asegurar(new.empresa_id,
      coalesce((select c.prefijo_factura from facturacion_config c where c.empresa_id = new.empresa_id), 'VTA-'));
    update ventas_numeracion n
       set ultimo = venta_numero_sufijo(new.numero_control, n.prefijo), updated_at = now()
     where n.empresa_id = new.empresa_id
       and venta_numero_sufijo(new.numero_control, n.prefijo) > n.ultimo;
  end if;
  return null;
end;
$fn$;
revoke execute on function :"schema".tg_ventas_numeracion() from public, anon, authenticated;

drop trigger if exists trg_ventas_numeracion on :"schema".ventas;
create trigger trg_ventas_numeracion after insert or delete or update of numero_control, empresa_id on :"schema".ventas
  for each row execute function :"schema".tg_ventas_numeracion();
drop trigger if exists trg_ventas_numeracion_truncate on :"schema".ventas;
create trigger trg_ventas_numeracion_truncate after truncate on :"schema".ventas
  for each statement execute function :"schema".tg_ventas_numeracion();

-- Cambio de prefijo en Configuración › Facturación: la fila del prefijo nuevo queda lista.
create or replace function :"schema".tg_facturacion_config_numeracion()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  perform venta_numeracion_asegurar(new.empresa_id, coalesce(new.prefijo_factura, 'VTA-'));
  return null;
end;
$fn$;
revoke execute on function :"schema".tg_facturacion_config_numeracion() from public, anon, authenticated;
drop trigger if exists trg_facturacion_config_numeracion on :"schema".facturacion_config;
create trigger trg_facturacion_config_numeracion after insert or update of prefijo_factura on :"schema".facturacion_config
  for each row execute function :"schema".tg_facturacion_config_numeracion();

-- Inicializar / corregir: una fila por empresa con su prefijo actual (o VTA-), más una por
-- cada prefijo ya conocido; el valor siempre desde las ventas (re-aplicar la receta lo corrige).
insert into :"schema".ventas_numeracion (empresa_id, prefijo, ultimo)
select x.empresa_id, x.prefijo, :"schema".venta_numeracion_contar(x.empresa_id, x.prefijo)
  from (select e.id as empresa_id, coalesce(c.prefijo_factura, 'VTA-') as prefijo
          from :"schema".empresas e left join :"schema".facturacion_config c on c.empresa_id = e.id
        union
        select n.empresa_id, n.prefijo from :"schema".ventas_numeracion n) x
on conflict (empresa_id, prefijo) do update set ultimo = excluded.ultimo, updated_at = now()
  where ventas_numeracion.ultimo is distinct from excluded.ultimo;

-- Misma firma y mismo resultado que la 61; ahora lee el contador (sin recorrer ventas).
create or replace function :"schema".siguiente_numero_venta(p_empresa uuid)
returns text language plpgsql stable security invoker set search_path = :"schema", public as $fn$
declare
  v_pref text := 'VTA-';
  v_ini bigint := 1;
  v_max bigint;
  v_n text;
begin
  select c.prefijo_factura, c.numeracion_inicial into v_pref, v_ini from facturacion_config c where c.empresa_id = p_empresa;
  v_pref := coalesce(v_pref, 'VTA-');
  v_ini := coalesce(v_ini, 1);
  select n.ultimo into v_max from ventas_numeracion n where n.empresa_id = p_empresa and n.prefijo = v_pref;
  if not found then
    v_max := venta_numeracion_contar(p_empresa, v_pref);  -- sin fila todavía: como antes
  end if;
  v_n := greatest(coalesce(v_max, 0) + 1, v_ini)::text;
  return v_pref || case when length(v_n) >= 6 then v_n else lpad(v_n, 6, '0') end;
end;
$fn$;
revoke all on function :"schema".siguiente_numero_venta(uuid) from public, anon;
grant execute on function :"schema".siguiente_numero_venta(uuid) to authenticated, service_role;

-- "Último número" de config_facturacion (order by created_at desc limit 1) sin ordenar todas.
create index if not exists ventas_empresa_created_idx on :"schema".ventas (empresa_id, created_at desc);

-- ═════════════════════════════════════════════════════════════════════════════
-- A. Búsqueda omnicanal: primero los candidatos por índice, después la regla de la 87
-- ═════════════════════════════════════════════════════════════════════════════
-- Antes, con búsqueda, chat_bandeja / chat_finalizadas calculaban chat_rango_busqueda
-- (≈100 µs, función SQL con CTE) + tel_busqueda + norm(...) para CADA conversación de la
-- empresa: ~2 s con 20.000 conversaciones, con o sin errores de tipeo. Ahora:
--   1. chat_conversaciones_busqueda (87) guarda además los "datos" de cada conversación
--      EXACTAMENTE como los arma la 87 (datos = bandeja, datos_fin = Finalizadas), con
--      índice de trigramas; los mantienen triggers de conversaciones, contactos, clientes,
--      prospectos, familias / estados de tipificación y usuarios.
--   2. chat_busqueda_candidatos arma por índice el conjunto de conversaciones que PUEDEN
--      coincidir: por cada palabra (de 3+ letras; las cortas no filtran, y cualquier
--      subconjunto de palabras sirve) LIKE '%raíz%' en datos / último mensaje / texto de
--      mensajes, o word_similarity(palabra, datos) >= 0.4 con el operador `<%` (umbral
--      0.399, mismo valor que compara la 87); se intersectan; + RUC / CI / teléfono exacto.
--   3. La regla de la 87 (chat_rango_busqueda, ahora en plpgsql, mismo resultado) se evalúa
--      solo sobre esos candidatos → mismo resultado, mismo orden.
-- Si cambian norm() / tel_busqueda() / clientes.busqueda / crm_prospectos.busqueda en una
-- receta futura, re-aplicar esta (recalcula todos los datos).

-- pg_trgm cargado en la sesión (para el SET pg_trgm.* de chat_busqueda_candidatos).
do $$ begin perform extensions.similarity('a', 'b'); end $$;

alter table :"schema".chat_conversaciones_busqueda add column if not exists datos text;
alter table :"schema".chat_conversaciones_busqueda add column if not exists datos_fin text;
create index if not exists chat_conv_busq_datos_trgm on :"schema".chat_conversaciones_busqueda
  using gin (datos extensions.gin_trgm_ops);
create index if not exists chat_conv_busq_datos_fin_trgm on :"schema".chat_conversaciones_busqueda
  using gin (datos_fin extensions.gin_trgm_ops);

-- Recalcula datos / datos_fin de esas conversaciones (mismas expresiones que la 87).
create or replace function :"schema".chat_busqueda_datos_recalcular(p_convs uuid[])
returns void language sql volatile security definer set search_path = :"schema", public as $$
  insert into chat_conversaciones_busqueda as b (conversacion_id, empresa_id, texto, datos, datos_fin, updated_at)
  select c.id, c.empresa_id, '',
         concat_ws(' ', norm(k.nombre), tel_busqueda(k.telefono), cl.busqueda, pr.busqueda, norm(array_to_string(c.etiquetas, ' '))),
         concat_ws(' ', norm(k.nombre), tel_busqueda(k.telefono), cl.busqueda, pr.busqueda, norm(array_to_string(c.etiquetas, ' ')),
                   norm(c.cierre_observacion), norm(f.nombre), norm(e.nombre), norm(u.nombre), norm(c.proxima_accion_nota)),
         now()
    from chat_conversaciones c
    join chat_contactos k on k.id = c.contacto_id
    left join clientes cl on cl.id = k.cliente_id
    left join crm_prospectos pr on pr.id = k.prospecto_id
    left join tipificacion_familias f on f.id = c.cierre_familia_id
    left join tipificacion_estados e on e.id = c.cierre_estado_id
    left join usuarios u on u.id = c.cerrada_por
   where c.id = any(p_convs)
  on conflict (conversacion_id) do update
     set datos = excluded.datos, datos_fin = excluded.datos_fin, empresa_id = excluded.empresa_id
   where b.datos is distinct from excluded.datos or b.datos_fin is distinct from excluded.datos_fin
      or b.empresa_id is distinct from excluded.empresa_id
$$;
revoke execute on function :"schema".chat_busqueda_datos_recalcular(uuid[]) from public, anon, authenticated;

create or replace function :"schema".tg_chat_busqueda_datos()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_convs uuid[];
begin
  if tg_table_name = 'chat_conversaciones' then
    v_convs := array[new.id];
  elsif tg_table_name = 'chat_contactos' then
    v_convs := array(select c.id from chat_conversaciones c where c.contacto_id = new.id);
  elsif tg_table_name = 'clientes' then
    v_convs := array(select c.id from chat_contactos k join chat_conversaciones c on c.contacto_id = k.id
                      where k.cliente_id = case when tg_op = 'DELETE' then old.id else new.id end);
  elsif tg_table_name = 'crm_prospectos' then
    v_convs := array(select c.id from chat_contactos k join chat_conversaciones c on c.contacto_id = k.id
                      where k.prospecto_id = case when tg_op = 'DELETE' then old.id else new.id end);
  elsif tg_table_name = 'tipificacion_familias' then
    v_convs := array(select c.id from chat_conversaciones c where c.cierre_familia_id = case when tg_op = 'DELETE' then old.id else new.id end);
  elsif tg_table_name = 'tipificacion_estados' then
    v_convs := array(select c.id from chat_conversaciones c where c.cierre_estado_id = case when tg_op = 'DELETE' then old.id else new.id end);
  elsif tg_table_name = 'usuarios' then
    v_convs := array(select c.id from chat_conversaciones c where c.cerrada_por = case when tg_op = 'DELETE' then old.id else new.id end);
  end if;
  if coalesce(cardinality(v_convs), 0) > 0 then
    perform chat_busqueda_datos_recalcular(v_convs);
  end if;
  return null;
end;
$fn$;
revoke execute on function :"schema".tg_chat_busqueda_datos() from public, anon, authenticated;

drop trigger if exists trg_chat_busqueda_datos on :"schema".chat_conversaciones;
create trigger trg_chat_busqueda_datos after insert or update of contacto_id, etiquetas, cierre_observacion, proxima_accion_nota,
    cierre_familia_id, cierre_estado_id, cerrada_por, empresa_id on :"schema".chat_conversaciones
  for each row execute function :"schema".tg_chat_busqueda_datos();
drop trigger if exists trg_chat_busqueda_datos on :"schema".chat_contactos;
create trigger trg_chat_busqueda_datos after update of nombre, telefono, cliente_id, prospecto_id on :"schema".chat_contactos
  for each row
  when (old.nombre is distinct from new.nombre or old.telefono is distinct from new.telefono
        or old.cliente_id is distinct from new.cliente_id or old.prospecto_id is distinct from new.prospecto_id)
  execute function :"schema".tg_chat_busqueda_datos();
-- busqueda la arma un trigger BEFORE: por eso sin lista de columnas y comparando el valor.
drop trigger if exists trg_chat_busqueda_datos on :"schema".clientes;
create trigger trg_chat_busqueda_datos after update on :"schema".clientes
  for each row when (old.busqueda is distinct from new.busqueda)
  execute function :"schema".tg_chat_busqueda_datos();
drop trigger if exists trg_chat_busqueda_datos_del on :"schema".clientes;
create trigger trg_chat_busqueda_datos_del after delete on :"schema".clientes
  for each row execute function :"schema".tg_chat_busqueda_datos();
drop trigger if exists trg_chat_busqueda_datos on :"schema".crm_prospectos;
create trigger trg_chat_busqueda_datos after update on :"schema".crm_prospectos
  for each row when (old.busqueda is distinct from new.busqueda)
  execute function :"schema".tg_chat_busqueda_datos();
drop trigger if exists trg_chat_busqueda_datos_del on :"schema".crm_prospectos;
create trigger trg_chat_busqueda_datos_del after delete on :"schema".crm_prospectos
  for each row execute function :"schema".tg_chat_busqueda_datos();
drop trigger if exists trg_chat_busqueda_datos on :"schema".tipificacion_familias;
create trigger trg_chat_busqueda_datos after update of nombre on :"schema".tipificacion_familias
  for each row when (old.nombre is distinct from new.nombre) execute function :"schema".tg_chat_busqueda_datos();
drop trigger if exists trg_chat_busqueda_datos_del on :"schema".tipificacion_familias;
create trigger trg_chat_busqueda_datos_del after delete on :"schema".tipificacion_familias
  for each row execute function :"schema".tg_chat_busqueda_datos();
drop trigger if exists trg_chat_busqueda_datos on :"schema".tipificacion_estados;
create trigger trg_chat_busqueda_datos after update of nombre on :"schema".tipificacion_estados
  for each row when (old.nombre is distinct from new.nombre) execute function :"schema".tg_chat_busqueda_datos();
drop trigger if exists trg_chat_busqueda_datos_del on :"schema".tipificacion_estados;
create trigger trg_chat_busqueda_datos_del after delete on :"schema".tipificacion_estados
  for each row execute function :"schema".tg_chat_busqueda_datos();
drop trigger if exists trg_chat_busqueda_datos on :"schema".usuarios;
create trigger trg_chat_busqueda_datos after update of nombre on :"schema".usuarios
  for each row when (old.nombre is distinct from new.nombre) execute function :"schema".tg_chat_busqueda_datos();
drop trigger if exists trg_chat_busqueda_datos_del on :"schema".usuarios;
create trigger trg_chat_busqueda_datos_del after delete on :"schema".usuarios
  for each row execute function :"schema".tg_chat_busqueda_datos();

-- Completar / corregir todas (solo escribe las que cambian).
select :"schema".chat_busqueda_datos_recalcular(array(select c.id from :"schema".chat_conversaciones c));

-- Índices para candidatos exactos (RUC / CI / teléfono) y último mensaje.
-- RUC / CI (con y sin DV) y teléfono del cliente, como los compara la 87 (ruc_igual / teléfono).
create or replace function :"schema".chat_cliente_claves(p_ruc text, p_documento text, p_telefono text)
returns text[] language sql immutable parallel safe set search_path = :"schema", public as $$
  select array[compacto(p_ruc), compacto(split_part(p_ruc, '-', 1)),
               compacto(p_documento), compacto(split_part(p_documento, '-', 1)),
               regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g')]
$$;
create index if not exists clientes_claves_chat_idx on :"schema".clientes
  using gin (:"schema".chat_cliente_claves(ruc, documento, telefono));
create index if not exists chat_contactos_tel_digitos_idx on :"schema".chat_contactos
  (regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g'));
create index if not exists chat_conv_contacto_idx on :"schema".chat_conversaciones (contacto_id);
create index if not exists chat_conv_preview_trgm on :"schema".chat_conversaciones
  using gin (:"schema".norm(ultimo_preview) extensions.gin_trgm_ops);

-- Conversaciones de la empresa que pueden coincidir con la búsqueda (null = no se puede
-- filtrar: evaluar todas). p_final: datos de Finalizadas (datos_fin).
create or replace function :"schema".chat_busqueda_candidatos(p_tk text[], p_qc text, p_tels text[], p_final boolean default false)
returns uuid[]
language plpgsql stable
set search_path = :"schema", public, extensions
set pg_trgm.word_similarity_threshold = 0.399
as $fn$
declare
  v_emp uuid := empresa_actual();
  v_res uuid[];
  v_set uuid[];
  v_filtro boolean := false;
  w record;
  r text;
  fz boolean;
begin
  if v_emp is null or coalesce(cardinality(p_tk), 0) = 0 then return null; end if;

  -- Primero las palabras más largas (y con letras); se corta cuando quedan pocos.
  for w in select u.t, u.o::integer as o from unnest(p_tk) with ordinality u(t, o)
            order by length(u.t) desc, (u.t ~ '[a-z]') desc, u.o loop
    exit when v_filtro and cardinality(v_res) <= 300;
    continue when length(w.t) < 3;
    r := '%' || raiz_busqueda(w.t) || '%';
    fz := length(w.t) >= 4 and w.t ~ '[a-z]';  -- "parecido" posible (como chat_rango_busqueda)
    if p_final then
      v_set := array(
        select b.conversacion_id from chat_conversaciones_busqueda b
         where b.empresa_id = v_emp and (b.datos_fin like r or b.texto like r)
        union
        select b.conversacion_id from chat_conversaciones_busqueda b
         where fz and b.empresa_id = v_emp and w.t <% b.datos_fin
        union
        select c.id from chat_conversaciones c where c.empresa_id = v_emp and norm(c.ultimo_preview) like r);
    else
      v_set := array(
        select b.conversacion_id from chat_conversaciones_busqueda b
         where b.empresa_id = v_emp and (b.datos like r or b.texto like r)
        union
        select b.conversacion_id from chat_conversaciones_busqueda b
         where fz and b.empresa_id = v_emp and w.t <% b.datos
        union
        select c.id from chat_conversaciones c where c.empresa_id = v_emp and norm(c.ultimo_preview) like r);
    end if;

    if v_filtro then
      v_res := array(select unnest(v_res) intersect select unnest(v_set));
    else
      v_res := v_set;
      v_filtro := true;
    end if;
  end loop;

  if not v_filtro then return null; end if;

  -- RUC / CI / teléfono exacto (no necesita que coincidan las palabras).
  if length(p_qc) >= 5 then
    v_res := array(
      select unnest(v_res)
      union
      select c.id from clientes cl join chat_contactos ko on ko.cliente_id = cl.id join chat_conversaciones c on c.contacto_id = ko.id
       where c.empresa_id = v_emp and chat_cliente_claves(cl.ruc, cl.documento, cl.telefono) && (array[p_qc] || coalesce(p_tels, '{}'))
      union
      select c.id from chat_contactos ko join chat_conversaciones c on c.contacto_id = ko.id
       where c.empresa_id = v_emp and regexp_replace(coalesce(ko.telefono, ''), '[^0-9]', '', 'g') = any(coalesce(p_tels, '{}')));
  end if;
  return v_res;
end;
$fn$;
revoke execute on function :"schema".chat_busqueda_candidatos(text[], text, text[], boolean) from public, anon;
grant execute on function :"schema".chat_busqueda_candidatos(text[], text, text[], boolean) to authenticated, service_role;
-- chat_rango_busqueda (87), misma firma y mismo resultado, en plpgsql: la versión SQL (con
-- CTE y SET search_path) costaba ~100 µs por fila; ahora una pasada por las palabras, sin
-- SET (esquema escrito en el cuerpo) y el "parecido" solo cuando hace falta (no cambia el
-- resultado: una palabra que ya está tal cual no necesita parecerse).
set search_path to :"schema", public;
do $do$
begin
  execute format($f$
create or replace function %1$I.chat_rango_busqueda(p_nombres text[], p_datos text, p_preview text, p_texto_msg text,
  p_toks integer[], p_exacto boolean, p_q text, p_tk text[])
returns integer language plpgsql immutable parallel safe as $b$
declare
  v_datos text := coalesce(p_datos, '');
  v_prev text := coalesce(p_preview, '');
  v_msg text := coalesce(p_texto_msg, '');
  v_toks integer[] := coalesce(p_toks, '{}');
  v_exacto boolean := coalesce(p_exacto, false);
  b_datos boolean := true;    -- todas en los datos
  b_prev boolean := true;     -- todas en datos o último mensaje
  b_real boolean := true;     -- todas tal cual (datos, último mensaje o mensajes)
  b_alguno boolean := true;   -- todas tal cual o parecidas
  t text;
  o integer := 0;
  r text;
  ed boolean;
  ep boolean;
  em boolean;
begin
  if p_tk is not null then
    foreach t in array p_tk loop
      o := o + 1;
      r := '%%' || %1$I.raiz_busqueda(t) || '%%';
      ed := v_datos like r;
      ep := v_prev like r;
      em := o = any(v_toks) or (length(t) < 3 and p_toks is not null and v_msg like '%%' || t || '%%');
      b_datos := b_datos and ed;
      b_prev := b_prev and (ed or ep);
      b_real := b_real and (ed or ep or em);
      if b_alguno and not (ed or ep or em) then
        b_alguno := length(t) >= 4 and t ~ '[a-z]' and extensions.word_similarity(t, v_datos) >= 0.4;
      end if;
    end loop;
  end if;
  if not (b_alguno or v_exacto) then return -1; end if;
  if not (b_real or v_exacto) then return 0; end if;
  if p_q <> '' then
    if p_q = any(p_nombres) then return 7; end if;
    if exists (select 1 from unnest(p_nombres) n where n like p_q || '%%') then return 6; end if;
    if exists (select 1 from unnest(p_nombres) n where n like '%%' || p_q || '%%') then return 5; end if;
  end if;
  if v_exacto then return 4; end if;
  if b_datos then return 3; end if;
  if b_prev then return 2; end if;
  return 1;
end
$b$$f$, current_schema());
end;
$do$;
set search_path to :"schema", public, extensions;

-- RUC / CI / teléfono exacto (lo que la 87 calculaba por fila como p_exacto): conversaciones
-- de la empresa que cumplen EXACTAMENTE ese criterio; por índice + el mismo predicado.
create or replace function :"schema".chat_busqueda_exactos(p_qc text, p_tels text[])
returns uuid[] language sql stable set search_path = :"schema", public as $$
  select coalesce(array_agg(distinct c.id), '{}')
    from chat_conversaciones c
    join chat_contactos k on k.id = c.contacto_id
    left join clientes cl on cl.id = k.cliente_id
   where length(p_qc) >= 5
     and c.empresa_id = empresa_actual()
     and c.id in (
       select c2.id from clientes cl2 join chat_contactos k2 on k2.cliente_id = cl2.id join chat_conversaciones c2 on c2.contacto_id = k2.id
        where chat_cliente_claves(cl2.ruc, cl2.documento, cl2.telefono) && (array[p_qc] || coalesce(p_tels, '{}'))
       union
       select c2.id from chat_contactos k2 join chat_conversaciones c2 on c2.contacto_id = k2.id
        where regexp_replace(coalesce(k2.telefono, ''), '[^0-9]', '', 'g') = any(coalesce(p_tels, '{}')))
     and (ruc_igual(cl.ruc, p_qc) or ruc_igual(cl.documento, p_qc)
          or regexp_replace(coalesce(k.telefono, ''), '[^0-9]', '', 'g') = any(p_tels)
          or regexp_replace(coalesce(cl.telefono, ''), '[^0-9]', '', 'g') = any(p_tels))
$$;
revoke execute on function :"schema".chat_busqueda_exactos(text, text[]) from public, anon;
grant execute on function :"schema".chat_busqueda_exactos(text, text[]) to authenticated, service_role;

-- ── chat_bandeja / chat_finalizadas: las de la 87 con los cambios marcados "95" ──────
create or replace function :"schema".chat_bandeja(p_vista text default 'mias', p_q text default null, p_asignado uuid default null,
  p_canal uuid default null, p_cursor_at timestamptz default null, p_cursor_id uuid default null, p_limite integer default 40,
  p_cola uuid default null, p_sin_asignar boolean default false, p_offset integer default 0)
returns jsonb
language plpgsql stable
set search_path = :"schema", public, extensions
set plan_cache_mode = force_custom_plan  -- 95: el plan se arma con los candidatos ya conocidos
as $$
declare
  v_yo uuid;
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := btrim(regexp_replace(norm(p_q), '\s+', ' ', 'g'));
  v_qc text := compacto(p_q);
  v_tels text[] := case when compacto(p_q) ~ '^[0-9]{7,15}$' then string_to_array(tel_busqueda(compacto(p_q)), ' ') else '{}' end;
  v_lim integer := least(greatest(coalesce(p_limite, 40), 1), 100);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb;
  v_cand uuid[];  -- 95: conversaciones que pueden coincidir (null = todas)
  v_ex uuid[];    -- 95: RUC / CI / teléfono exacto
begin
  select id into v_yo from usuarios where auth_user_id = auth.uid() limit 1;

  if coalesce(cardinality(v_tk), 0) = 0 then
    -- Sin búsqueda: keyset por último mensaje (igual que la 86).
    select coalesce(jsonb_agg(b order by b.ultimo_mensaje_at desc nulls last, b.id desc), '[]'::jsonb) into v_rows
      from (
        select c.id, c.estado, c.asignado_id, c.canal_id, c.cola_id, c.prioridad, c.ultimo_mensaje_at, c.ultimo_preview, c.ultimo_from_me,
               c.ultimo_tipo, c.no_leidos, c.ventana_expira_at, c.etiquetas, c.sla_vence_at, c.primera_respuesta_at, c.espera_motivo,
               k.id as contacto_id, k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.avatar_url, k.cliente_id, k.prospecto_id,
               ca.tipo as canal_tipo, ca.nombre as canal_nombre, u.nombre as asignado_nombre, q.nombre as cola_nombre
          from chat_conversaciones c
          join chat_contactos k on k.id = c.contacto_id
          join chat_canales ca on ca.id = c.canal_id
          left join usuarios u on u.id = c.asignado_id
          left join chat_colas q on q.id = c.cola_id
         where c.empresa_id = empresa_actual()
           and case coalesce(p_vista, 'mias')
                 when 'mias' then c.asignado_id = v_yo and c.estado <> 'cerrada'
                 when 'sin_asignar' then c.asignado_id is null and c.estado <> 'cerrada'
                 when 'cerradas' then c.estado = 'cerrada'
                 else c.estado <> 'cerrada' end
           and (p_asignado is null or c.asignado_id = p_asignado)
           and (not coalesce(p_sin_asignar, false) or c.asignado_id is null)
           and (p_canal is null or c.canal_id = p_canal)
           and (p_cola is null or c.cola_id = p_cola)
           and (p_cursor_at is null or (c.ultimo_mensaje_at, c.id) < (p_cursor_at, p_cursor_id))
         order by c.ultimo_mensaje_at desc nulls last, c.id desc
         limit v_lim
      ) b;
  else
    -- Con búsqueda: relevancia, luego el más reciente; paginado por p_offset.
    v_ex := chat_busqueda_exactos(v_qc, v_tels);  -- 95
    v_cand := chat_busqueda_candidatos(v_tk, v_qc, v_tels, false);  -- 95
    if v_cand is not null then v_cand := v_cand || v_ex; end if;  -- 95 (null = sin filtro)
    with msg as materialized (select * from chat_msg_tokens(v_tk)),
    base as (
      select c.id, c.estado, c.asignado_id, c.canal_id, c.cola_id, c.prioridad, c.ultimo_mensaje_at, c.ultimo_preview, c.ultimo_from_me,
             c.ultimo_tipo, c.no_leidos, c.ventana_expira_at, c.etiquetas, c.sla_vence_at, c.primera_respuesta_at, c.espera_motivo,
             k.id as contacto_id, k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.avatar_url, k.cliente_id, k.prospecto_id,
             ca.tipo as canal_tipo, ca.nombre as canal_nombre, u.nombre as asignado_nombre, q.nombre as cola_nombre,
             chat_rango_busqueda(
               array[norm(k.nombre), norm(cl.nombre), norm(cl.razon_social), norm(pr.empresa), norm(pr.contacto)],
               coalesce(bd.datos, concat_ws(' ', norm(k.nombre), tel_busqueda(k.telefono), cl.busqueda, pr.busqueda, norm(array_to_string(c.etiquetas, ' ')))),  -- 95
               norm(c.ultimo_preview), cb.texto, m.toks,
               c.id = any(v_ex),  -- 95: mismo criterio, precalculado
               v_q, v_tk) as _r
        from chat_conversaciones c
        join chat_contactos k on k.id = c.contacto_id
        join chat_canales ca on ca.id = c.canal_id
        left join usuarios u on u.id = c.asignado_id
        left join chat_colas q on q.id = c.cola_id
        left join clientes cl on cl.id = k.cliente_id
        left join crm_prospectos pr on pr.id = k.prospecto_id
        left join msg m on m.conversacion_id = c.id
        left join chat_conversaciones_busqueda cb on cb.conversacion_id = m.conversacion_id
        left join chat_conversaciones_busqueda bd on bd.conversacion_id = c.id  -- 95: datos guardados
       where c.empresa_id = empresa_actual()
         and (v_cand is null or c.id = any(v_cand))  -- 95
         and case coalesce(p_vista, 'mias')
               when 'mias' then c.asignado_id = v_yo and c.estado <> 'cerrada'
               when 'sin_asignar' then c.asignado_id is null and c.estado <> 'cerrada'
               when 'cerradas' then c.estado = 'cerrada'
               else c.estado <> 'cerrada' end
         and (p_asignado is null or c.asignado_id = p_asignado)
         and (not coalesce(p_sin_asignar, false) or c.asignado_id is null)
         and (p_canal is null or c.canal_id = p_canal)
         and (p_cola is null or c.cola_id = p_cola)
    ),
    -- Si algo coincide tal cual, lo que solo se parece no se muestra.
    hits as (select * from base where _r >= 0 and (_r > 0 or not exists (select 1 from base where _r > 0))),
    pag as (select * from hits order by _r desc, ultimo_mensaje_at desc nulls last, id desc limit v_lim offset v_off)
    select coalesce(jsonb_agg((to_jsonb(p) - '_r') || jsonb_build_object('coincidencia', s.frag)
                              order by p._r desc, p.ultimo_mensaje_at desc nulls last, p.id desc), '[]'::jsonb) into v_rows
      from pag p
      left join lateral (
        -- El mensaje (no automático) con más palabras buscadas; a igualdad, el más nuevo.
        select chat_fragmento(coalesce(mm.contenido, mm.media_nombre), v_tk) as frag
          from chat_mensajes mm
          cross join lateral (select chat_texto_busqueda_msg(mm.tipo, mm.contenido, mm.media_nombre) as t) x
         where p._r = 1 and mm.conversacion_id = p.id and x.t is not null
           and exists (select 1 from unnest(v_tk) w where length(w) >= 3 and x.t like '%' || raiz_busqueda(w) || '%')
         order by (select count(*) from unnest(v_tk) w where x.t like '%' || raiz_busqueda(w) || '%') desc, mm.created_at desc, mm.id desc
         limit 1
      ) s on true;
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'contadores', (select jsonb_build_object(
        'mias', count(*) filter (where asignado_id = v_yo and estado <> 'cerrada'),
        'mias_no_leidas', count(*) filter (where asignado_id = v_yo and estado <> 'cerrada' and no_leidos > 0),
        'sin_asignar', count(*) filter (where asignado_id is null and estado <> 'cerrada'),
        'abiertas', count(*) filter (where estado <> 'cerrada'))
      from chat_conversaciones where empresa_id = empresa_actual() and estado <> 'cerrada')
  );
end;
$$;
revoke execute on function :"schema".chat_bandeja(text, text, uuid, uuid, timestamptz, uuid, integer, uuid, boolean, integer) from public, anon;
grant execute on function :"schema".chat_bandeja(text, text, uuid, uuid, timestamptz, uuid, integer, uuid, boolean, integer) to authenticated, service_role;

create or replace function :"schema".chat_finalizadas(p_desde date default null, p_hasta date default null, p_asesor uuid default null,
  p_estado uuid default null, p_q text default null, p_cursor_at timestamptz default null, p_cursor_id uuid default null,
  p_limite integer default 50, p_cola uuid default null, p_asignado uuid default null, p_semaforo text default null,
  p_seguimientos boolean default false, p_cursor_fecha date default null, p_alcance uuid[] default null, p_offset integer default 0)
returns jsonb
language plpgsql stable
set search_path = :"schema", public, extensions
set plan_cache_mode = force_custom_plan  -- 95: el plan se arma con los candidatos ya conocidos
as $$
declare
  v_tk text[] := tokens_busqueda(p_q);
  v_q text := btrim(regexp_replace(norm(p_q), '\s+', ' ', 'g'));
  v_qc text := compacto(p_q);
  v_tels text[] := case when compacto(p_q) ~ '^[0-9]{7,15}$' then string_to_array(tel_busqueda(compacto(p_q)), ' ') else '{}' end;
  v_lim integer := least(greatest(coalesce(p_limite, 50), 1), 200);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_seg boolean := coalesce(p_seguimientos, false);
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_rows jsonb;
  v_cand uuid[];  -- 95: conversaciones que pueden coincidir (null = todas)
  v_ex uuid[];    -- 95: RUC / CI / teléfono exacto
begin
  if coalesce(cardinality(v_tk), 0) = 0 then
    -- Sin búsqueda: igual que la 86 (keyset por cierre o por próxima acción).
    select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('semaforo',
                 case when r.dias_asesor is null then 'sin' when r.dias_asesor <= 2 then 'verde' when r.dias_asesor <= 6 then 'ambar' else 'rojo' end)
               order by case when v_seg then r.proxima_accion_fecha end, case when v_seg then r.id end, r.cerrada_at desc, r.id desc), '[]'::jsonb)
      into v_rows
      from (
        select c.id, c.cerrada_at, c.cierre_observacion, c.etiquetas, c.created_at, c.primera_respuesta_at,
               k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.cliente_id,
               u.nombre as cerrada_por_nombre, f.nombre as cierre_familia, e.nombre as cierre_estado, ca.nombre as canal,
               c.asignado_id, ua.nombre as asignado_nombre, c.cola_id, q.nombre as cola,
               c.ultimo_msg_asesor_at, v_hoy - (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date as dias_asesor,
               c.proxima_accion_fecha, c.proxima_accion_nota, c.seguimiento_hecho_at
          from chat_conversaciones c
          join chat_contactos k on k.id = c.contacto_id
          join chat_canales ca on ca.id = c.canal_id
          left join usuarios u on u.id = c.cerrada_por
          left join usuarios ua on ua.id = c.asignado_id
          left join chat_colas q on q.id = c.cola_id
          left join tipificacion_familias f on f.id = c.cierre_familia_id
          left join tipificacion_estados e on e.id = c.cierre_estado_id
         where c.empresa_id = empresa_actual() and c.estado = 'cerrada'
           and (p_alcance is null or c.cerrada_por = any(p_alcance) or c.asignado_id = any(p_alcance))
           and (p_asesor is null or c.cerrada_por = p_asesor)
           and (p_asignado is null or c.asignado_id = p_asignado)
           and (p_cola is null or c.cola_id = p_cola)
           and (p_estado is null or c.cierre_estado_id = p_estado)
           and (p_semaforo is null or case p_semaforo
                  when 'sin' then c.ultimo_msg_asesor_at is null
                  when 'verde' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date >= v_hoy - 2
                  when 'ambar' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date between v_hoy - 6 and v_hoy - 3
                  when 'rojo' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date <= v_hoy - 7
                  else true end)
           and (case when v_seg
                  then c.proxima_accion_fecha is not null and c.seguimiento_hecho_at is null
                       and (p_desde is null or c.proxima_accion_fecha >= p_desde)
                       and (p_hasta is null or c.proxima_accion_fecha <= p_hasta)
                       and (p_cursor_fecha is null or (c.proxima_accion_fecha, c.id) > (p_cursor_fecha, p_cursor_id))
                  else (p_desde is null or c.cerrada_at >= p_desde::timestamp at time zone 'America/Asuncion')
                       and (p_hasta is null or c.cerrada_at < (p_hasta + 1)::timestamp at time zone 'America/Asuncion')
                       and (p_cursor_at is null or (c.cerrada_at, c.id) < (p_cursor_at, p_cursor_id))
                end)
         order by case when v_seg then c.proxima_accion_fecha end, case when v_seg then c.id end, c.cerrada_at desc, c.id desc
         limit v_lim
      ) r;
  else
    v_ex := chat_busqueda_exactos(v_qc, v_tels);  -- 95
    v_cand := chat_busqueda_candidatos(v_tk, v_qc, v_tels, true);  -- 95
    if v_cand is not null then v_cand := v_cand || v_ex; end if;  -- 95 (null = sin filtro)
    with msg as materialized (select * from chat_msg_tokens(v_tk)),
    base as (
      select c.id, c.cerrada_at, c.cierre_observacion, c.etiquetas, c.created_at, c.primera_respuesta_at,
             k.nombre as contacto_nombre, k.telefono as contacto_telefono, k.cliente_id,
             u.nombre as cerrada_por_nombre, f.nombre as cierre_familia, e.nombre as cierre_estado, ca.nombre as canal,
             c.asignado_id, ua.nombre as asignado_nombre, c.cola_id, q.nombre as cola,
             c.ultimo_msg_asesor_at, v_hoy - (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date as dias_asesor,
             c.proxima_accion_fecha, c.proxima_accion_nota, c.seguimiento_hecho_at,
             chat_rango_busqueda(
               array[norm(k.nombre), norm(cl.nombre), norm(cl.razon_social), norm(pr.empresa), norm(pr.contacto)],
               coalesce(bd.datos_fin, concat_ws(' ', norm(k.nombre), tel_busqueda(k.telefono), cl.busqueda, pr.busqueda, norm(array_to_string(c.etiquetas, ' ')),
                         norm(c.cierre_observacion), norm(f.nombre), norm(e.nombre), norm(u.nombre), norm(c.proxima_accion_nota))),  -- 95
               norm(c.ultimo_preview), cb.texto, m.toks,
               c.id = any(v_ex),  -- 95: mismo criterio, precalculado
               v_q, v_tk) as _r
        from chat_conversaciones c
        join chat_contactos k on k.id = c.contacto_id
        join chat_canales ca on ca.id = c.canal_id
        left join usuarios u on u.id = c.cerrada_por
        left join usuarios ua on ua.id = c.asignado_id
        left join chat_colas q on q.id = c.cola_id
        left join tipificacion_familias f on f.id = c.cierre_familia_id
        left join tipificacion_estados e on e.id = c.cierre_estado_id
        left join clientes cl on cl.id = k.cliente_id
        left join crm_prospectos pr on pr.id = k.prospecto_id
        left join msg m on m.conversacion_id = c.id
        left join chat_conversaciones_busqueda cb on cb.conversacion_id = m.conversacion_id
        left join chat_conversaciones_busqueda bd on bd.conversacion_id = c.id  -- 95: datos guardados
       where c.empresa_id = empresa_actual() and c.estado = 'cerrada'
         and (v_cand is null or c.id = any(v_cand))  -- 95
         and (p_alcance is null or c.cerrada_por = any(p_alcance) or c.asignado_id = any(p_alcance))
         and (p_asesor is null or c.cerrada_por = p_asesor)
         and (p_asignado is null or c.asignado_id = p_asignado)
         and (p_cola is null or c.cola_id = p_cola)
         and (p_estado is null or c.cierre_estado_id = p_estado)
         and (p_semaforo is null or case p_semaforo
                when 'sin' then c.ultimo_msg_asesor_at is null
                when 'verde' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date >= v_hoy - 2
                when 'ambar' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date between v_hoy - 6 and v_hoy - 3
                when 'rojo' then (c.ultimo_msg_asesor_at at time zone 'America/Asuncion')::date <= v_hoy - 7
                else true end)
         and (case when v_seg
                then c.proxima_accion_fecha is not null and c.seguimiento_hecho_at is null
                     and (p_desde is null or c.proxima_accion_fecha >= p_desde)
                     and (p_hasta is null or c.proxima_accion_fecha <= p_hasta)
                else (p_desde is null or c.cerrada_at >= p_desde::timestamp at time zone 'America/Asuncion')
                     and (p_hasta is null or c.cerrada_at < (p_hasta + 1)::timestamp at time zone 'America/Asuncion')
              end)
    ),
    hits as (select * from base where _r >= 0 and (_r > 0 or not exists (select 1 from base where _r > 0))),
    pag as (
      select * from hits
       order by _r desc, case when v_seg then proxima_accion_fecha end, case when v_seg then id end, cerrada_at desc, id desc
       limit v_lim offset v_off
    )
    select coalesce(jsonb_agg((to_jsonb(r) - '_r') || jsonb_build_object('semaforo',
                 case when r.dias_asesor is null then 'sin' when r.dias_asesor <= 2 then 'verde' when r.dias_asesor <= 6 then 'ambar' else 'rojo' end)
               order by r._r desc, case when v_seg then r.proxima_accion_fecha end, case when v_seg then r.id end, r.cerrada_at desc, r.id desc), '[]'::jsonb)
      into v_rows
      from pag r;
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    -- Para la pestaña Seguimientos: pendientes (y vencidos) en el alcance de quien mira.
    'seguimientos', (select jsonb_build_object('pendientes', count(*), 'vencidos', count(*) filter (where c.proxima_accion_fecha < v_hoy))
        from chat_conversaciones c
       where c.empresa_id = empresa_actual() and c.estado = 'cerrada'
         and c.proxima_accion_fecha is not null and c.seguimiento_hecho_at is null
         and (p_alcance is null or c.cerrada_por = any(p_alcance) or c.asignado_id = any(p_alcance))
         and (p_asesor is null or c.cerrada_por = p_asesor))
  );
end;
$$;
revoke execute on function :"schema".chat_finalizadas(date, date, uuid, uuid, text, timestamptz, uuid, integer, uuid, uuid, text, boolean, date, uuid[], integer) from public, anon;
grant execute on function :"schema".chat_finalizadas(date, date, uuid, uuid, text, timestamptz, uuid, integer, uuid, uuid, text, boolean, date, uuid[], integer)
  to authenticated, service_role;


reset search_path;
