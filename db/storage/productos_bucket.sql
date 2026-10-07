-- =============================================================================
-- Storage para imágenes de productos. A diferencia de los schemas por tenant, el
-- storage de Supabase es GLOBAL del proyecto: un solo bucket "productos" (público
-- para lectura) alcanza para todas las empresas. El aislamiento se da por el PATH:
-- cada archivo se sube bajo "<schema>/<uuid>". IDEMPOTENTE.
-- Se aplica UNA vez por instancia de Supabase (no por clon de schema).
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do update set public = true;

-- Lectura pública la sirve /storage/v1/object/public; igual dejamos SELECT abierto.
drop policy if exists productos_leer on storage.objects;
create policy productos_leer on storage.objects for select
  using (bucket_id = 'productos');

-- Subir / reemplazar / borrar: cualquier usuario autenticado (la app ya pasó el portón).
drop policy if exists productos_subir on storage.objects;
create policy productos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'productos');

drop policy if exists productos_actualizar on storage.objects;
create policy productos_actualizar on storage.objects for update to authenticated
  using (bucket_id = 'productos') with check (bucket_id = 'productos');

drop policy if exists productos_borrar on storage.objects;
create policy productos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'productos');
