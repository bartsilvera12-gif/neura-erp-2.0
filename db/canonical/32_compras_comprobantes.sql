-- =============================================================================
-- Compras: comprobantes adjuntos (foto o PDF de la factura del proveedor).
--   · compras_comprobantes   uno o más archivos por compra: nombre original, ruta en el
--                            storage, tipo, tamaño, quién lo subió y cuándo. Se borra
--                            con la compra (on delete cascade).
--   · bucket PRIVADO "compras" (20 MB por archivo). Ruta:
--       compras/{empresa_id}/{compra_id}/{uuid}-{nombre}
--     ("compras" es el bucket; storage_path guarda {empresa_id}/{compra_id}/…)
--     La sube el servidor (API) y se ve con URLs firmadas de corta duración.
-- RLS por empresa_actual(). IDEMPOTENTE.
-- =============================================================================
set search_path = :"schema", public, extensions;

create table if not exists :"schema".compras_comprobantes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  compra_id uuid not null references :"schema".compras(id) on delete cascade,
  nombre text not null,
  storage_path text not null,
  mime text,
  size bigint,
  subido_por uuid,
  created_at timestamptz not null default now()
);
create index if not exists compras_comprobantes_compra_idx on :"schema".compras_comprobantes(compra_id, created_at);
create index if not exists compras_comprobantes_empresa_idx on :"schema".compras_comprobantes(empresa_id);
create unique index if not exists uq_compras_comprobantes_path on :"schema".compras_comprobantes(storage_path);

-- --- RLS ---
alter table :"schema".compras_comprobantes enable row level security;
alter table :"schema".compras_comprobantes force row level security;
drop policy if exists compras_comprobantes_propios on :"schema".compras_comprobantes;
create policy compras_comprobantes_propios on :"schema".compras_comprobantes to authenticated
  using (empresa_id = :"schema".empresa_actual()) with check (empresa_id = :"schema".empresa_actual());
grant select, insert, update, delete on :"schema".compras_comprobantes to authenticated, service_role;

-- --- Storage: bucket privado (sin políticas para la sesión del usuario: todo pasa por la API) ---
insert into storage.buckets (id, name, public, file_size_limit)
values ('compras', 'compras', false, 20971520)
on conflict (id) do nothing;
