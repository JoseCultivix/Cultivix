-- =====================================================================
-- CULTIVIX · 0003 · ALMACENAMIENTO DE ARCHIVOS (fotos, albaranes, PDFs)
-- Bucket privado "documentos". Ruta: {empresa_id}/{tipo}/{archivo}
-- Solo los miembros de la empresa pueden leer/subir en su carpeta.
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

create policy "docs_leer_empresa" on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and public.es_miembro(((storage.foldername(name))[1])::uuid));

create policy "docs_subir_empresa" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and public.es_miembro(((storage.foldername(name))[1])::uuid));

create policy "docs_borrar_gestor" on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and public.es_gestor(((storage.foldername(name))[1])::uuid));
