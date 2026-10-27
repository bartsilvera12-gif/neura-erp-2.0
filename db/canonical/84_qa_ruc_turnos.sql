-- =============================================================================
-- QA: EL RUC DE "DATOS PARA FACTURACIÓN" TAMBIÉN SE VALIDA (dígito verificador).
--
--   · ruc_receptor(ruc, documento) (66): antes devolvía clientes.ruc SIN validar → se pudo
--     facturar a un cliente con RUC 80011222-7 (el DV correcto es 9). Ahora:
--       - si clientes.ruc tiene algo, tiene que ser un RUC válido (ruc_valido de 57); si no
--         lo es, NO hay RUC para factura (no se cae al documento);
--       - si está vacío, el documento SOLO si es un RUC válido (igual que antes).
--     Se guarda normalizado (sin puntos ni espacios).
--   · exigir_ruc_factura (67): distingue "sin RUC" de "RUC con DV mal" → "El RUC del cliente
--     no es válido: …". La usan el trigger tg_ventas_receptor, crear_venta (vigente: 73),
--     emitir_factura_contado y emitir_cuota_suscripcion (66): no hace falta redefinirlas.
--   · Cliente ocasional (X): sin cambios (el trigger lo resuelve antes, receta 67).
--   · Datos demo: RUC / documentos de los clientes de ejemplo con el DV correcto.
--
-- IDEMPOTENTE. Va después de 83. Si se vuelve a correr 66 o 67, correr 84 después.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- Los RUC de ejemplo tienen que dar con la función de la base (si no, algo está mal en 57).
do $$
begin
  if not (ruc_valido('80012345-0') and ruc_valido('80098765-9') and ruc_valido('80011222-9') and ruc_valido('3456789-5'))
     or ruc_valido('80011222-7') or ruc_valido('80012345-6') then
    raise exception 'ruc_valido() no da los dígitos verificadores esperados';
  end if;
end $$;

-- =============================================================================
-- 1. RUC del receptor: el de Datos para facturación tiene que ser válido
-- =============================================================================
create or replace function :"schema".ruc_normalizado(p text)
returns text language sql immutable set search_path = :"schema", public as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[\s.]', '', 'g')), '')
$$;

create or replace function :"schema".ruc_receptor(p_ruc text, p_documento text)
returns text language sql immutable set search_path = :"schema", public as $$
  select case
           when ruc_normalizado(p_ruc) is not null
             then case when ruc_valido(ruc_normalizado(p_ruc)) then ruc_normalizado(p_ruc) end
           when ruc_valido(ruc_normalizado(p_documento)) then ruc_normalizado(p_documento)
         end
$$;

-- =============================================================================
-- 2. Error claro: sin RUC / RUC con el dígito verificador mal
-- =============================================================================
create or replace function :"schema".exigir_ruc_factura(p_cliente uuid)
returns void language plpgsql stable set search_path = :"schema", public as $fn$
declare
  c record;
  v_doc text;
  v_cand text;
  v_base text;
  v_dv integer;
begin
  if p_cliente is null then
    raise exception 'Para emitir factura elegí un cliente con RUC o "Cliente ocasional (X)". Sin cliente solo se puede emitir ticket.';
  end if;
  select cl.nombre, cl.razon_social, cl.ruc, cl.documento into c from clientes cl where cl.id = p_cliente;
  if not found then raise exception 'Cliente no encontrado'; end if;
  if ruc_receptor(c.ruc, c.documento) is null then
    -- 84: hay un RUC cargado (o el documento tiene forma de RUC) pero no es válido.
    v_doc := ruc_normalizado(c.documento);
    v_cand := coalesce(ruc_normalizado(c.ruc), case when v_doc ~ '^\d{3,8}-\d$' then v_doc end);
    if v_cand is not null then
      v_base := split_part(v_cand, '-', 1);
      v_dv := case when v_base ~ '^\d{3,8}$' then ruc_dv(v_base) end;
      raise exception 'El RUC del cliente no es válido: % (%). Corregilo en Datos para facturación del cliente "%" para poder facturar.',
        v_cand,
        case when v_dv is not null then 'el dígito verificador de ' || v_base || ' es ' || v_dv || ': debería ser ' || v_base || '-' || v_dv
             else 'van de 3 a 8 números, guion y el dígito verificador, ej. 80012345-0' end,
        nombre_receptor(c.razon_social, c.nombre);
    end if;
    raise exception 'El cliente "%" no tiene RUC: solo se puede emitir ticket. Cargá su RUC en Datos para facturación (con la CI sola no se puede facturar).',
      nombre_receptor(c.razon_social, c.nombre);
  end if;
end;
$fn$;

-- =============================================================================
-- 3. Datos demo: RUC con el dígito verificador correcto (solo si siguen con el valor viejo)
-- =============================================================================
update clientes set documento = '80012345-0', updated_at = now()
 where nombre = 'Cliente Uno' and documento = '80012345-6' and deleted_at is null;
update clientes set ruc = '80012345-0', updated_at = now()
 where nombre = 'Cliente Uno' and ruc = '80012345-6' and deleted_at is null;
update clientes set documento = '80098765-9', updated_at = now()
 where nombre = 'Cliente Dos' and documento = '80098765-4' and deleted_at is null;
update clientes set ruc = '80098765-9', updated_at = now()
 where nombre = 'Cliente Dos' and ruc = '80098765-4' and deleted_at is null;
update clientes set documento = '80011222-9', updated_at = now()
 where nombre = 'Kiosco El Sol' and documento = '80011222-7' and deleted_at is null;
update clientes set ruc = '80011222-9', updated_at = now()
 where nombre = 'Kiosco El Sol' and ruc = '80011222-7' and deleted_at is null;
-- Con guion es RUC (persona física): el DV de 3456789 es 5.
update clientes set documento = '3456789-5', updated_at = now()
 where nombre = 'Despensa Doña Rosa' and documento = '3456789-0' and deleted_at is null;

-- =============================================================================
-- 4. Permisos
-- =============================================================================
revoke all on function :"schema".ruc_normalizado(text) from public, anon;
revoke all on function :"schema".ruc_receptor(text, text) from public, anon;
revoke all on function :"schema".exigir_ruc_factura(uuid) from public, anon;
grant execute on function :"schema".ruc_normalizado(text) to authenticated, service_role;
grant execute on function :"schema".ruc_receptor(text, text) to authenticated, service_role;
grant execute on function :"schema".exigir_ruc_factura(uuid) to authenticated, service_role;

commit;
