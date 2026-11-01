-- CULTIVIX · 0005 · Ajustes de seguridad recomendados por el asesor de Supabase
alter function set_updated_at() set search_path = public;
alter function partes_before_write() set search_path = public;
alter function lineas_parte_defaults() set search_path = public;
alter function partes_propagar_horas() set search_path = public;

revoke execute on function rol_en(uuid), es_miembro(uuid), es_gestor(uuid), es_admin(uuid), puede_editar_parte(uuid) from public, anon;
grant execute on function rol_en(uuid), es_miembro(uuid), es_gestor(uuid), es_admin(uuid), puede_editar_parte(uuid) to authenticated;
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function guardar_parte(jsonb), validar_partes(uuid[]), registrar_albaran(jsonb) from public, anon;
