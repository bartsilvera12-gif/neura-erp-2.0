-- =============================================================================
-- Storage para imágenes de productos: bucket público "erp-productos" (lo crea también la receta
-- 122). Desde el 3-nov-2026 sube SOLO el servidor (/api/productos/imagen) con el cliente de
-- sistema, así que no hay políticas de escritura: en un Supabase compartido ningún usuario de
-- otro sistema puede subir ahí. La lectura es por la URL pública. IDEMPOTENTE.
-- Se aplica UNA vez por instancia de Supabase (no por clon de schema).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('erp-productos', 'erp-productos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
