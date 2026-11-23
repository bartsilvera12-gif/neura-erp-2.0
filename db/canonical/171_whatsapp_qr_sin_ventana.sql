-- =============================================================================
-- 171 — WhatsApp por QR (puente Baileys): sin ventana de 24 h.
--
-- La regla "pasadas 24 h del último mensaje del cliente solo se aceptan plantillas" es de la API
-- oficial (YCloud / Meta). Un número vinculado por QR no tiene plantillas ni ventana: se le puede
-- escribir siempre. La ventana la calcula tg_chat_mensaje_nuevo (receta 36) para todo canal de
-- WhatsApp; acá, para los canales con proveedor 'baileys', se la deja abierta.
--
-- Va en un trigger aparte (corre DESPUÉS de trg_chat_mensaje_nuevo: mismo evento, orden alfabético)
-- para no reescribir la función de la receta 36. Aditivo e IDEMPOTENTE. Va después de 170.
-- =============================================================================
begin;
set local search_path to :"schema", public;

create or replace function :"schema".tg_chat_mensaje_qr_ventana()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  update chat_conversaciones c
     set ventana_expira_at = new.created_at + interval '100 years'
    from chat_canales ca
   where c.id = new.conversacion_id and ca.id = c.canal_id and ca.proveedor = 'baileys';
  return null;
end;
$fn$;

drop trigger if exists trg_chat_mensaje_qr_ventana on :"schema".chat_mensajes;
create trigger trg_chat_mensaje_qr_ventana after insert on :"schema".chat_mensajes
  for each row when (not new.from_me and new.tipo <> 'nota')
  execute function :"schema".tg_chat_mensaje_qr_ventana();

commit;
