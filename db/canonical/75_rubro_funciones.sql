-- =============================================================================
-- RUBRO Y FUNCIONES (pedido del dueño, 27-oct-2026).
--
-- El ERP sirve para cualquier rubro. Todo lo gastronómico (recetas 68–73) se puede APAGAR por
-- empresa y la Caja funciona sola. Configuración › Rubro y funciones (/configuracion/funciones):
--   · Rubro: Comercio (ferretería, almacén, tienda) → las tres funciones apagadas;
--            Gastronomía (restaurante, bar, pizzería) → las tres prendidas.
--            Si la combinación no coincide con ninguno: "Personalizado".
--   · Funciones:
--       mesas    Mesas y QR (Pedidos de mesas, cuentas abiertas, menú público /m/<token>).
--       cocina   Cocina y estaciones (requiere Mesas).
--       recetas  Recetas e ingredientes (tipos de producto Menú/Materia prima, recetas, modificadores).
--   Apagar NO borra nada; volver a prender deja todo como estaba.
--
-- Tabla
--   · empresa_funciones   una fila por empresa (sin fila = Comercio: todo apagado, el default de
--                         las empresas nuevas). funciones_ocultas: Neura oculta la sección al
--                         cliente (sin UI, solo por SQL; con true la pantalla no aparece y
--                         guardar_funciones_empresa rechaza cambios).
--
-- Funciones
--   · funcion_activa(empresa, funcion)   interna (cocina exige también mesas).
--   · funciones_empresa()                cualquier usuario con sesión: rubro, funciones, si puede
--                                        editar y, para el Administrador, cuántas cuentas de mesa
--                                        abiertas / pedidos sin cerrar y productos Menú/Materia
--                                        prima activos hay (para avisar antes de apagar).
--   · guardar_funciones_empresa(p jsonb) solo nivel ADMIN + "Configuración del sistema".
--        p = { rubro?: 'comercio'|'gastronomia', mesas?, cocina?, recetas?, confirmar_recetas? }
--        Protecciones: no apaga Mesas con cuentas abiertas o pedidos sin cerrar ("Cobrá o liberá
--        las mesas abiertas primero"); apagar Recetas con productos Menú/Materia prima activos
--        pide confirmar_recetas = true (hint 'confirmar_recetas:<n>').
--   · mesa_qr_activo(token)              anon: ¿el local de esa mesa toma pedidos por QR?
--   · Triggers en mesa_cuentas / mesa_pedidos (BEFORE INSERT): con Mesas apagada no entra ningún
--     pedido por QR ("Este local no está tomando pedidos por QR"), sin redefinir
--     mesa_pedido_publico_crear (68/72/73/74).
--
-- Neura — ocultar / mostrar la sección a un cliente (reemplazar el schema):
--   insert into <schema>.empresa_funciones (empresa_id, funciones_ocultas)
--     select id, true from <schema>.empresas
--   on conflict (empresa_id) do update set funciones_ocultas = true, updated_at = now();
--   -- mostrarla de nuevo:
--   update <schema>.empresa_funciones set funciones_ocultas = false, updated_at = now();
--   -- (el servidor la lee con un cache de ~15 s)
--
-- Semilla: SOLO en erp_demo, Gastronomía (todo prendido) para sus empresas (la primera vez).
-- IDEMPOTENTE. Va después de 74. No redefine funciones de mesas ni de recetas.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- =============================================================================
-- 1. Tabla
-- =============================================================================
create table if not exists :"schema".empresa_funciones (
  empresa_id uuid primary key references :"schema".empresas(id) on delete cascade,
  mesas boolean not null default false,
  cocina boolean not null default false,
  recetas boolean not null default false,
  funciones_ocultas boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references :"schema".usuarios(id) on delete set null,
  constraint chk_empresa_funciones_cocina check (not cocina or mesas)
);
comment on table :"schema".empresa_funciones is
  'Rubro y funciones (receta 75): mesas / cocina / recetas por empresa. Sin fila = Comercio (todo apagado). funciones_ocultas solo por SQL (Neura).';

alter table :"schema".empresa_funciones enable row level security;
alter table :"schema".empresa_funciones force row level security;
drop policy if exists empresa_funciones_propia on :"schema".empresa_funciones;
create policy empresa_funciones_propia on :"schema".empresa_funciones for select to authenticated
  using (empresa_id = :"schema".empresa_actual());
revoke all on :"schema".empresa_funciones from anon, authenticated;
grant select on :"schema".empresa_funciones to authenticated;
grant all on :"schema".empresa_funciones to service_role;

-- =============================================================================
-- 2. Lectura
-- =============================================================================
create or replace function :"schema".funcion_activa(p_empresa uuid, p_funcion text)
returns boolean language sql stable security definer set search_path = :"schema", public as $$
  select coalesce((
    select case p_funcion
             when 'mesas' then f.mesas
             when 'cocina' then f.cocina and f.mesas
             when 'recetas' then f.recetas
             else false end
      from empresa_funciones f where f.empresa_id = p_empresa), false)
$$;

create or replace function :"schema".funciones_empresa()
returns jsonb language plpgsql stable security definer set search_path = :"schema", public as $fn$
declare
  s record;
  f empresa_funciones;
  v_mesas boolean;
  v_cocina boolean;
  v_recetas boolean;
  v_ocultas boolean;
  v_admin boolean;
  v_rubro text;
begin
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  select * into f from empresa_funciones where empresa_id = s.p_empresa;
  v_mesas := coalesce(f.mesas, false);
  v_cocina := coalesce(f.cocina, false) and v_mesas;
  v_recetas := coalesce(f.recetas, false);
  v_ocultas := coalesce(f.funciones_ocultas, false);
  v_admin := s.p_rol = 'ADMIN' and tiene_permiso('configuracion');
  v_rubro := case when not v_mesas and not v_cocina and not v_recetas then 'comercio'
                  when v_mesas and v_cocina and v_recetas then 'gastronomia'
                  else 'personalizado' end;
  return jsonb_build_object(
    'rubro', v_rubro,
    'mesas', v_mesas,
    'cocina', v_cocina,
    'recetas', v_recetas,
    'ocultas', v_ocultas,
    'puede_editar', v_admin and not v_ocultas,
    'cuentas_abiertas', case when v_admin then (select count(*) from mesa_cuentas c where c.empresa_id = s.p_empresa and c.estado = 'abierta') end,
    'pedidos_sin_cerrar', case when v_admin then (
        select count(*) from mesa_pedidos p join mesa_cuentas c on c.id = p.cuenta_id
         where p.empresa_id = s.p_empresa and c.estado = 'abierta'
           and p.estado in ('nuevo', 'aceptado', 'en_preparacion', 'listo')) end,
    'productos_recetas', case when v_admin then (
        select count(*) from productos pr
         where pr.empresa_id = s.p_empresa and pr.activo and pr.tipo_producto in ('menu', 'materia_prima')) end);
end;
$fn$;

-- =============================================================================
-- 3. Escritura
-- =============================================================================
create or replace function :"schema".guardar_funciones_empresa(p jsonb)
returns jsonb language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  s record;
  f empresa_funciones;
  v_mesas boolean;
  v_cocina boolean;
  v_recetas boolean;
  v_n integer;
  v_k text;
begin
  select * into s from perfil_sesion();
  if s.p_usuario is null then raise exception 'No hay una sesión activa' using errcode = '42501'; end if;
  if s.p_rol <> 'ADMIN' then
    raise exception 'Solo el Administrador puede cambiar el rubro y las funciones' using errcode = '42501';
  end if;
  perform exigir_permiso('configuracion');
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Faltan los datos de las funciones'; end if;

  insert into empresa_funciones (empresa_id) values (s.p_empresa) on conflict (empresa_id) do nothing;
  select * into f from empresa_funciones where empresa_id = s.p_empresa for update;
  if f.funciones_ocultas then
    raise exception 'Esta sección no está disponible para tu empresa' using errcode = '42501';
  end if;

  v_mesas := f.mesas;
  v_cocina := f.cocina;
  v_recetas := f.recetas;

  if p ? 'rubro' then
    case p->>'rubro'
      when 'comercio' then v_mesas := false; v_cocina := false; v_recetas := false;
      when 'gastronomia' then v_mesas := true; v_cocina := true; v_recetas := true;
      else raise exception 'Rubro inválido (Comercio o Gastronomía)';
    end case;
  end if;
  foreach v_k in array array['mesas', 'cocina', 'recetas', 'confirmar_recetas'] loop
    if p ? v_k and jsonb_typeof(p->v_k) <> 'boolean' then raise exception '"%" debe ser sí o no', v_k; end if;
  end loop;
  if p ? 'mesas' then v_mesas := (p->>'mesas')::boolean; end if;
  if p ? 'cocina' then v_cocina := (p->>'cocina')::boolean; end if;
  if p ? 'recetas' then v_recetas := (p->>'recetas')::boolean; end if;
  if v_cocina and not v_mesas then
    if p ? 'cocina' and (p->>'cocina')::boolean then
      raise exception 'Cocina y estaciones necesita Mesas y QR: prendé Mesas y QR primero';
    end if;
    v_cocina := false; -- apagar Mesas apaga Cocina
  end if;

  -- Apagar Mesas: sin cuentas abiertas ni pedidos sin cerrar.
  if f.mesas and not v_mesas then
    select count(*) into v_n from mesa_cuentas where empresa_id = s.p_empresa and estado = 'abierta';
    if v_n > 0 then
      raise exception 'Cobrá o liberá las mesas abiertas primero: hay % cuenta% de mesa abierta%',
        v_n, case when v_n = 1 then '' else 's' end, case when v_n = 1 then '' else 's' end;
    end if;
    select count(*) into v_n from mesa_pedidos where empresa_id = s.p_empresa and estado in ('nuevo', 'aceptado', 'en_preparacion', 'listo')
      and cuenta_id in (select id from mesa_cuentas where empresa_id = s.p_empresa and estado = 'abierta');
    if v_n > 0 then
      raise exception 'Cobrá o liberá las mesas abiertas primero: hay % pedido% sin cerrar', v_n, case when v_n = 1 then '' else 's' end;
    end if;
  end if;

  -- Apagar Recetas con productos Menú / Materia prima activos: pide confirmación (no bloquea).
  if f.recetas and not v_recetas and not coalesce((p->>'confirmar_recetas')::boolean, false) then
    select count(*) into v_n from productos where empresa_id = s.p_empresa and activo and tipo_producto in ('menu', 'materia_prima');
    if v_n > 0 then
      raise exception 'Hay % producto% activo% de tipo Menú o Materia prima. Siguen existiendo; confirmá para apagar Recetas',
        v_n, case when v_n = 1 then '' else 's' end, case when v_n = 1 then '' else 's' end
        using hint = 'confirmar_recetas:' || v_n;
    end if;
  end if;

  update empresa_funciones
     set mesas = v_mesas, cocina = v_cocina, recetas = v_recetas, updated_at = now(), updated_by = s.p_usuario
   where empresa_id = s.p_empresa;
  return funciones_empresa();
end;
$fn$;

-- =============================================================================
-- 4. Pedidos por QR con Mesas apagada (sin redefinir las funciones públicas)
-- =============================================================================
create or replace function :"schema".mesa_qr_activo(p_token text)
returns boolean language sql stable security definer set search_path = :"schema", public as $$
  select coalesce((select funcion_activa(m.empresa_id, 'mesas') from mesas m
                    where p_token ~ '^[0-9a-f]{64}$' and m.token = p_token), false)
$$;

create or replace function :"schema".tg_mesas_funcion_activa()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  if not funcion_activa(new.empresa_id, 'mesas') then
    raise exception 'Este local no está tomando pedidos por QR. Pedile a quien te atiende.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_mesa_cuentas_funcion on :"schema".mesa_cuentas;
create trigger trg_mesa_cuentas_funcion before insert on :"schema".mesa_cuentas
  for each row execute function :"schema".tg_mesas_funcion_activa();
drop trigger if exists trg_mesa_pedidos_funcion on :"schema".mesa_pedidos;
create trigger trg_mesa_pedidos_funcion before insert on :"schema".mesa_pedidos
  for each row execute function :"schema".tg_mesas_funcion_activa();

-- =============================================================================
-- 5. Permisos de ejecución
-- =============================================================================
revoke all on function :"schema".funcion_activa(uuid, text) from public, anon, authenticated;
revoke all on function :"schema".funciones_empresa() from public, anon;
revoke all on function :"schema".guardar_funciones_empresa(jsonb) from public, anon;
revoke all on function :"schema".mesa_qr_activo(text) from public;
revoke all on function :"schema".tg_mesas_funcion_activa() from public, anon, authenticated;
grant execute on function :"schema".funcion_activa(uuid, text) to service_role;
grant execute on function :"schema".funciones_empresa() to authenticated, service_role;
grant execute on function :"schema".guardar_funciones_empresa(jsonb) to authenticated, service_role;
grant execute on function :"schema".mesa_qr_activo(text) to anon, authenticated, service_role;

-- =============================================================================
-- 6. Semilla (solo erp_demo, la primera vez): Gastronomía
-- =============================================================================
select (:'schema' = 'erp_demo') as es_demo \gset
\if :es_demo
insert into :"schema".empresa_funciones (empresa_id, mesas, cocina, recetas)
  select e.id, true, true, true from :"schema".empresas e
on conflict (empresa_id) do nothing;
\endif

commit;
