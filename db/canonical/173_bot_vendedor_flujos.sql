-- =============================================================================
-- 173 — Flujos del bot vendedor (Omnicanal › Bot vendedor › Flujo).
--
-- Un flujo es el guion que sigue el bot: pasos (cajas en un diagrama, con su posición) unidos por
-- flechas. Cada paso tiene un tipo (saludo, categorías, productos, entrega, pago, confirmar…), un
-- título, la instrucción que la tienda escribe y si está prendido. La empresa puede tener varios
-- flujos y uno solo ACTIVO: es el que sigue el bot. Sin flujo activo, el bot usa el de fábrica
-- (src/lib/bot-vendedor/flujo.ts), que es el mismo guion de antes de esta receta.
--
--   estilo:     'menus' (opciones numeradas) | 'charla' (conversación libre)
--   nodos:      [{ id, tipo, titulo, instruccion, activo, x, y }]
--   conexiones: [{ id, de, a }]
--
-- Solo lo escribe el servidor (pantalla de ADMIN). Aditivo e IDEMPOTENTE. Va después de 172.
-- =============================================================================
begin;
set local search_path to :"schema", public;

create table if not exists :"schema".bot_vendedor_flujos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references :"schema".empresas(id) on delete cascade,
  nombre text not null,
  activo boolean not null default false,
  -- 'menus': opciones numeradas en cada paso · 'charla': conversación libre, menús solo si ayudan
  estilo text not null default 'menus' check (estilo in ('menus', 'charla')),
  nodos jsonb not null default '[]'::jsonb,
  conexiones jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references :"schema".usuarios(id) on delete set null,
  constraint chk_bot_flujo_nombre check (length(btrim(nombre)) between 1 and 80),
  constraint chk_bot_flujo_json check (jsonb_typeof(nodos) = 'array' and jsonb_typeof(conexiones) = 'array')
);
create index if not exists bot_vendedor_flujos_empresa_idx on :"schema".bot_vendedor_flujos (empresa_id, created_at);
-- Un solo flujo activo por empresa.
create unique index if not exists uq_bot_vendedor_flujo_activo on :"schema".bot_vendedor_flujos (empresa_id) where activo;

alter table :"schema".bot_vendedor_flujos enable row level security;
alter table :"schema".bot_vendedor_flujos force row level security;
revoke all on :"schema".bot_vendedor_flujos from anon, authenticated;
grant all on :"schema".bot_vendedor_flujos to service_role;

commit;

notify pgrst, 'reload schema';
