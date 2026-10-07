-- =============================================================================
-- Módulo CLIENTES (completo). "La mejor versión" combinando lo mejor de los ERPs:
--   - estructura limpia + anti-duplicados con candado en DB (de sistemas-propio)
--   - contactos múltiples por cliente
--   - CUENTA CORRIENTE con límite de crédito real (mejora que ningún ERP tenía):
--     el límite vive acá y la caja (crear_venta) bloquea la venta a crédito que lo supere.
-- Parametrizado por :schema, IDEMPOTENTE. Extiende la tabla `clientes` del core.
-- =============================================================================

-- --- Campos ricos del cliente (ADD COLUMN IF NOT EXISTS: no rompe datos existentes) ---
alter table :"schema".clientes add column if not exists tipo_cliente text not null default 'persona';
alter table :"schema".clientes add column if not exists razon_social text;
alter table :"schema".clientes add column if not exists ruc text;
alter table :"schema".clientes add column if not exists telefono text;
alter table :"schema".clientes add column if not exists email text;
alter table :"schema".clientes add column if not exists direccion text;
alter table :"schema".clientes add column if not exists ciudad text;
alter table :"schema".clientes add column if not exists condicion_pago text not null default 'CONTADO';
alter table :"schema".clientes add column if not exists limite_credito numeric not null default 0;
alter table :"schema".clientes add column if not exists vendedor_usuario_id uuid;
alter table :"schema".clientes add column if not exists origen text not null default 'MANUAL';
alter table :"schema".clientes add column if not exists notas text;
alter table :"schema".clientes add column if not exists activo boolean not null default true;
alter table :"schema".clientes add column if not exists created_by uuid;
alter table :"schema".clientes add column if not exists updated_at timestamptz not null default now();
alter table :"schema".clientes add column if not exists deleted_at timestamptz;

-- CHECKs (drop+add para que sean idempotentes y no fallen si ya existen).
alter table :"schema".clientes drop constraint if exists clientes_tipo_check;
alter table :"schema".clientes add  constraint clientes_tipo_check check (tipo_cliente = any (array['empresa','persona']));
alter table :"schema".clientes drop constraint if exists clientes_origen_check;
alter table :"schema".clientes add  constraint clientes_origen_check check (origen = any (array['MANUAL','VENTA','CRM']));
alter table :"schema".clientes drop constraint if exists clientes_limite_check;
alter table :"schema".clientes add  constraint clientes_limite_check check (limite_credito >= 0);

-- --- Anti-duplicados: candado duro en DB (documento único por empresa, vivos) ---
-- Normaliza a minúsculas/sin espacios; ignora los borrados (deleted_at).
create unique index if not exists clientes_documento_unico
  on :"schema".clientes (empresa_id, lower(btrim(documento)))
  where documento is not null and btrim(documento) <> '' and deleted_at is null;

create index if not exists clientes_activo_idx on :"schema".clientes(empresa_id, activo) where deleted_at is null;

-- --- Contactos múltiples por cliente ---
create table if not exists :"schema".cliente_contactos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  cliente_id uuid not null references :"schema".clientes(id) on delete cascade,
  nombre text not null,
  cargo text,
  telefono text,
  email text,
  notas text,
  created_at timestamptz not null default now()
);
create index if not exists cliente_contactos_cliente_idx on :"schema".cliente_contactos(cliente_id);
create index if not exists cliente_contactos_empresa_idx on :"schema".cliente_contactos(empresa_id);

-- --- RLS del nuevo (deny-by-default + política por empresa) ---
alter table :"schema".cliente_contactos enable row level security;
alter table :"schema".cliente_contactos force  row level security;
drop policy if exists cliente_contactos_propios on :"schema".cliente_contactos;
create policy cliente_contactos_propios on :"schema".cliente_contactos to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());

grant select, insert, update, delete on :"schema".cliente_contactos to authenticated, service_role;

-- =============================================================================
-- Cuenta corriente: saldo deudor del cliente = ventas a CRÉDITO vivas - lo cobrado.
-- Todavía no hay módulo de cobranzas, así que el cobrado es 0 y el saldo = suma de
-- ventas a crédito no anuladas. Función reutilizable (la usa la caja y el estado de cuenta).
-- =============================================================================
create or replace function :"schema".cliente_saldo(p_cliente_id uuid)
returns numeric language sql stable security invoker set search_path = :"schema", public as $$
  select coalesce(sum(total), 0)
    from ventas
   where cliente_id = p_cliente_id
     and empresa_id = empresa_actual()
     and tipo_venta = 'CREDITO'
     and estado <> 'anulada'
$$;

grant execute on function :"schema".cliente_saldo(uuid) to authenticated, service_role;
