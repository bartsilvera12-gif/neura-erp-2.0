-- =============================================================================
-- Conversaciones: quién puede escuchar cada tópico privado de Realtime.
--   chat:<empresa>            → solo usuarios de esa empresa
--   chat:conv:<conversacion>  → solo si la conversación es de su empresa
-- realtime.messages es de supabase_admin: APLICAR CONECTADO COMO supabase_admin
--   psql -U supabase_admin -v schema=<schema> -f 36b_conversaciones_realtime.sql
-- Una política por schema de tenant (el nombre lleva el schema). IDEMPOTENTE.
-- =============================================================================
\set politica chat_topicos_:schema
alter table realtime.messages enable row level security;
drop policy if exists :"politica" on realtime.messages;
create policy :"politica" on realtime.messages for select to authenticated
  using (
    (realtime.topic() like 'chat:conv:%' and exists (
       select 1 from :"schema".chat_conversaciones c
        where c.id::text = substring(realtime.topic() from 11) and c.empresa_id = :"schema".empresa_actual()))
    or realtime.topic() = 'chat:' || :"schema".empresa_actual()::text
  );
