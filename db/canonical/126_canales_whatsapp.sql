-- =============================================================================
-- CANALES DE WHATSAPP REALES (4-nov-2026): lo que hace falta para conectar YCloud o la API de Meta
-- cuando haya un cliente, sin tocar código.
--   · chat_canales.numero: el número que ve el cliente (el identificador es lo que manda el proveedor
--     en el webhook: el número de negocio en YCloud, el phone_number_id en Meta).
--   · ultimo_evento_at / ultimo_error: para ver desde la pantalla si el webhook está llegando.
--   · Las claves (api key, token, secreto del webhook) siguen en chat_canal_secretos: solo servidor.
--   · Un canal real nace APAGADO: se prende desde Omnicanal › Canales de WhatsApp después de probarlo.
-- IDEMPOTENTE. Va después de 125.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

alter table :"schema".chat_canales add column if not exists numero text;
alter table :"schema".chat_canales add column if not exists ultimo_evento_at timestamptz;
alter table :"schema".chat_canales add column if not exists ultimo_error text;
alter table :"schema".chat_canales add column if not exists ultimo_error_at timestamptz;

-- El simulador no tiene identificador; los reales sí (para rutear el webhook).
do $do$
begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  where c.conname = 'chk_chat_canales_identificador' and t.relnamespace = current_schema()::regnamespace) then
    alter table chat_canales add constraint chk_chat_canales_identificador
      check (proveedor = 'simulador' or identificador is not null) not valid;
  end if;
end;
$do$;

commit;

notify pgrst, 'reload schema';
