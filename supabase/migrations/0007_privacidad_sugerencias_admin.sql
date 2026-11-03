-- =====================================================================
-- CULTIVIX · 0007 · PRIVACIDAD (RGPD), SUGERENCIAS Y PANEL DE PLATAFORMA
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Aceptación de condiciones y política de privacidad (versión + fecha)
-- ---------------------------------------------------------------------
alter table usuarios add column if not exists acepta_terminos_version text;
alter table usuarios add column if not exists acepta_terminos_en timestamptz;

create or replace function aceptar_terminos(p_version text) returns void
language sql security definer set search_path = public as $$
  update usuarios set acepta_terminos_version = p_version, acepta_terminos_en = now() where id = auth.uid()
$$;

-- Último acceso (para el panel de uso de la beta)
create or replace function registrar_acceso() returns void
language sql security definer set search_path = public as $$
  update usuarios set ultimo_acceso = now()
   where id = auth.uid() and (ultimo_acceso is null or ultimo_acceso < now() - interval '10 minutes')
$$;

-- ---------------------------------------------------------------------
-- 2. Administradores de la plataforma (tú) — ven el uso y las sugerencias
-- ---------------------------------------------------------------------
create table if not exists plataforma_admins (
  usuario_id uuid primary key references usuarios(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table plataforma_admins enable row level security;
create policy pa_sel on plataforma_admins for select using (usuario_id = auth.uid());

create or replace function es_admin_plataforma() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from plataforma_admins where usuario_id = auth.uid())
$$;

insert into plataforma_admins (usuario_id)
select id from usuarios where lower(email) = 'joseibva@gmail.com'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Sugerencias y avisos de error desde la app
-- ---------------------------------------------------------------------
create table if not exists sugerencias (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid references usuarios(id) on delete set null default auth.uid(),
  empresa_id  uuid references empresas(id) on delete set null,
  tipo        text not null default 'sugerencia' check (tipo in ('sugerencia','error','idea','duda','otro')),
  valoracion  int check (valoracion between 1 and 5),
  texto       text not null check (length(texto) between 1 and 4000),
  pantalla    text,
  dispositivo text,
  estado      text not null default 'nueva' check (estado in ('nueva','vista','en_curso','hecha','descartada')),
  respuesta   text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sugerencias_fecha on sugerencias(created_at desc);
alter table sugerencias enable row level security;
create policy sug_ins on sugerencias for insert to authenticated
  with check (usuario_id = auth.uid() and (empresa_id is null or es_miembro(empresa_id)));
create policy sug_sel on sugerencias for select using (usuario_id = auth.uid() or es_admin_plataforma());
create policy sug_upd on sugerencias for update using (es_admin_plataforma()) with check (es_admin_plataforma());

-- ---------------------------------------------------------------------
-- 4. Panel de uso (solo administradores de la plataforma)
--    Solo cuenta actividad: no expone datos agrícolas ni económicos.
-- ---------------------------------------------------------------------
create or replace function admin_resumen_uso()
returns table (
  empresa_id uuid, empresa text, creada timestamptz, usuarios bigint, ultimo_acceso timestamptz,
  parcelas bigint, partes_total bigint, partes_7d bigint, dias_activos_14d bigint,
  entregas bigint, compras bigint, fotos bigint, ia_usos bigint, sugerencias bigint
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not es_admin_plataforma() then raise exception 'Solo administradores de Cultivix'; end if;
  return query
  select e.id, e.nombre, e.created_at,
    (select count(*) from empresa_usuarios eu where eu.empresa_id = e.id and eu.activo),
    (select max(u.ultimo_acceso) from empresa_usuarios eu join usuarios u on u.id = eu.usuario_id where eu.empresa_id = e.id),
    (select count(*) from parcelas p where p.empresa_id = e.id and p.activa),
    (select count(*) from partes_trabajo p where p.empresa_id = e.id and p.estado <> 'descartado'),
    (select count(*) from partes_trabajo p where p.empresa_id = e.id and p.created_at > now() - interval '7 days'),
    (select count(distinct x.d) from (
        select created_at::date d from partes_trabajo where empresa_id = e.id and created_at > now() - interval '14 days'
        union select created_at::date from entregas_cosecha where empresa_id = e.id and created_at > now() - interval '14 days'
        union select created_at::date from fotografias where empresa_id = e.id and created_at > now() - interval '14 days') x),
    (select count(*) from entregas_cosecha x where x.empresa_id = e.id),
    (select count(*) from albaranes_compra x where x.empresa_id = e.id),
    (select count(*) from fotografias x where x.empresa_id = e.id),
    (select count(*) from acciones_ia x where x.empresa_id = e.id),
    (select count(*) from sugerencias x where x.empresa_id = e.id)
  from empresas e
  order by 5 desc nulls last;
end $$;

-- Sugerencias con el nombre y email de quien las envía (para poder responderle)
create or replace function admin_sugerencias()
returns table (id uuid, tipo text, valoracion int, texto text, pantalla text, estado text, created_at timestamptz,
               usuario_nombre text, usuario_email text, empresa_nombre text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not es_admin_plataforma() then raise exception 'Solo administradores de Cultivix'; end if;
  return query
  select s.id, s.tipo, s.valoracion, s.texto, s.pantalla, s.estado, s.created_at, u.nombre, u.email, e.nombre
    from sugerencias s left join usuarios u on u.id = s.usuario_id left join empresas e on e.id = s.empresa_id
   order by s.created_at desc limit 500;
end $$;

-- ---------------------------------------------------------------------
-- 5. Derechos RGPD: exportar datos (portabilidad) y borrar explotación / cuenta
-- ---------------------------------------------------------------------
create or replace function exportar_datos_empresa(p_empresa uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare r jsonb := jsonb_build_object('exportado_en', now(), 'formato', 'Cultivix JSON v1'); t text; v jsonb;
begin
  if not es_admin(p_empresa) then raise exception 'Solo el titular o administrador puede exportar los datos'; end if;
  foreach t in array array['empresas','fincas','parcelas','recintos','campanas','recinto_cultivos','trabajadores',
    'maquinaria','aperos','maquinaria_documentos','averias','mantenimientos','labores','clientes','partes_trabajo',
    'proveedores','productos','albaranes_compra','stock_ajustes','aplicaciones','documentos','fotografias',
    'observaciones_agronomicas','destinos_cosecha','entregas_cosecha','liquidaciones_cosecha'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from %I x where %I = $1',
                   t, case when t = 'empresas' then 'id' else 'empresa_id' end)
      into v using p_empresa;
    r := r || jsonb_build_object(t, v);
  end loop;
  -- Tablas hijas sin empresa_id
  r := r || jsonb_build_object(
    'partes_trabajo_recintos', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from partes_trabajo_recintos x join partes_trabajo p on p.id = x.parte_trabajo_id where p.empresa_id = p_empresa),
    'partes_trabajo_trabajadores', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from partes_trabajo_trabajadores x join partes_trabajo p on p.id = x.parte_trabajo_id where p.empresa_id = p_empresa),
    'partes_trabajo_maquinaria', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from partes_trabajo_maquinaria x join partes_trabajo p on p.id = x.parte_trabajo_id where p.empresa_id = p_empresa),
    'partes_trabajo_aperos', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from partes_trabajo_aperos x join partes_trabajo p on p.id = x.parte_trabajo_id where p.empresa_id = p_empresa),
    'aplicaciones_productos', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from aplicaciones_productos x join aplicaciones a on a.id = x.aplicacion_id where a.empresa_id = p_empresa),
    'albaranes_compra_lineas', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from albaranes_compra_lineas x join albaranes_compra a on a.id = x.albaran_id where a.empresa_id = p_empresa),
    'entregas_cosecha_recintos', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from entregas_cosecha_recintos x join entregas_cosecha e on e.id = x.entrega_id where e.empresa_id = p_empresa));
  return r;
end $$;

-- Borrar una explotación completa (solo su propietario). Los archivos se borran antes desde la app.
create or replace function eliminar_empresa(p_empresa uuid, p_confirmacion text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if rol_en(p_empresa) is distinct from 'propietario' then raise exception 'Solo el propietario puede borrar la explotación'; end if;
  if p_confirmacion is distinct from 'BORRAR' then raise exception 'Confirmación incorrecta'; end if;
  delete from empresas where id = p_empresa;
end $$;

-- Borrar mi cuenta: si soy el único propietario de una explotación hay que borrarla antes.
create or replace function eliminar_mi_cuenta(p_confirmacion text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sin sesión'; end if;
  if p_confirmacion is distinct from 'BORRAR' then raise exception 'Confirmación incorrecta'; end if;
  if exists (select 1 from empresa_usuarios eu where eu.usuario_id = v_uid and eu.rol = 'propietario'
              and not exists (select 1 from empresa_usuarios o where o.empresa_id = eu.empresa_id and o.rol = 'propietario' and o.usuario_id <> v_uid)) then
    raise exception 'Eres el propietario de una explotación: bórrala primero (o transfiérela)';
  end if;
  update trabajadores set usuario_id = null where usuario_id = v_uid;
  delete from auth.users where id = v_uid;  -- en cascada borra el perfil y las pertenencias
end $$;

-- ---------------------------------------------------------------------
-- 6. Límite diario de uso de IA por usuario (evita abusos y sustos en la factura)
-- ---------------------------------------------------------------------
create or replace function ia_usos_hoy() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from acciones_ia where usuario_id = auth.uid() and created_at > now() - interval '24 hours'
$$;

-- ---------------------------------------------------------------------
-- 7. Permisos
-- ---------------------------------------------------------------------
revoke execute on function aceptar_terminos(text), registrar_acceso(), es_admin_plataforma(), admin_resumen_uso(), admin_sugerencias(),
  exportar_datos_empresa(uuid), eliminar_empresa(uuid, text), eliminar_mi_cuenta(text), ia_usos_hoy() from public, anon;
grant execute on function aceptar_terminos(text), registrar_acceso(), es_admin_plataforma(), admin_resumen_uso(), admin_sugerencias(),
  exportar_datos_empresa(uuid), eliminar_empresa(uuid, text), eliminar_mi_cuenta(text), ia_usos_hoy() to authenticated;

-- Tamaño máximo y tipos permitidos de archivo en el almacenamiento (fotos, PDFs)
update storage.buckets set file_size_limit = 15 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
 where id = 'documentos';
