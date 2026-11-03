-- =============================================================================
-- Buckets propios del ERP 2.0 (3-nov-2026): el storage es GLOBAL del Supabase y en producción ya
-- hay buckets "proyectos" (público, de otro sistema) y "cobros-comprobantes". El 2.0 pasa a usar
-- los suyos, todos con prefijo erp-, con los mismos límites de antes. Los privados no tienen
-- políticas (escribe y firma solo el servidor); los públicos (logos y productos) solo se leen
-- por la URL pública, también sin políticas de escritura.
-- Los archivos viejos no se mueven acá: storage no se copia por SQL (los de erp_demo se copiaron por
-- la API de storage al mudarlo a producción, 3-nov-2026).
-- IDEMPOTENTE.
-- =============================================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('erp-compras',             'erp-compras',             false, 20971520,  null),
  ('erp-soporte',             'erp-soporte',             false, 52428800,  null),
  ('erp-chat',                'erp-chat',                false, 104857600, null),
  ('erp-proyectos',           'erp-proyectos',           false, 52428800,  null),
  ('erp-cobros-comprobantes', 'erp-cobros-comprobantes', false, 8388608,   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('erp-empresas-logos',      'erp-empresas-logos',      true,  1048576,   array['image/png', 'image/jpeg']),
  ('erp-productos',           'erp-productos',           true,  5242880,   array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- Los adjuntos de soporte guardan su bucket en la fila.
alter table :"schema".soporte_ticket_archivos alter column storage_bucket set default 'erp-soporte';
update :"schema".soporte_ticket_archivos set storage_bucket = 'erp-soporte' where storage_bucket = 'soporte';

commit;
