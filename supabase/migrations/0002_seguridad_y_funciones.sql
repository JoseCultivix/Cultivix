-- =====================================================================
-- CULTIVIX · 0002 · SEGURIDAD (RLS) Y FUNCIONES
-- ---------------------------------------------------------------------
-- Regla de oro: cada usuario solo ve los datos de las empresas a las que
-- pertenece (empresa_usuarios). Sustituye a las políticas "using (true)"
-- del prototipo, que dejaban leer y escribir TODO a cualquiera con la
-- clave pública.
--
-- Roles:
--   propietario / administrador  → todo
--   encargado                    → todo lo operativo (no usuarios ni empresa)
--   trabajador                   → solo sus partes; sin datos económicos (FLUJO-060)
--   tecnico                      → lectura (permisos ampliables por el agricultor, DEC-059)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funciones de permisos (security definer para evitar recursión en RLS)
-- ---------------------------------------------------------------------
create or replace function rol_en(e uuid) returns text
language sql stable security definer set search_path = public as $$
  select rol from empresa_usuarios
   where empresa_id = e and usuario_id = auth.uid() and activo
   limit 1
$$;

create or replace function es_miembro(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select rol_en(e) is not null
$$;

create or replace function es_gestor(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(rol_en(e) in ('propietario','administrador','encargado'), false)
$$;

create or replace function es_admin(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(rol_en(e) in ('propietario','administrador'), false)
$$;

create or replace function puede_editar_parte(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from partes_trabajo pt
     where pt.id = p
       and ( es_gestor(pt.empresa_id)
             or (pt.creado_por = auth.uid() and pt.estado in ('en_curso','borrador','pendiente')) )
  )
$$;

-- ---------------------------------------------------------------------
-- Activar RLS en todas las tablas
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'empresas','usuarios','empresa_usuarios','invitaciones','modulos_empresa',
    'fincas','propietarios_terceros','parcelas','recintos','cultivos','campanas','recinto_cultivos',
    'trabajadores','maquinaria','aperos','maquinaria_documentos','averias','mantenimientos',
    'labores','clientes','partes_trabajo','partes_trabajo_recintos','partes_trabajo_trabajadores',
    'partes_trabajo_maquinaria','partes_trabajo_aperos',
    'proveedores','productos','documentos','albaranes_compra','albaranes_compra_lineas','stock_ajustes',
    'aplicaciones','aplicaciones_productos','fotografias','observaciones_agronomicas','acciones_ia']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- NÚCLEO
-- ---------------------------------------------------------------------
create policy empresas_sel on empresas for select using (es_miembro(id));
create policy empresas_upd on empresas for update using (es_admin(id)) with check (es_admin(id));
-- (alta de empresas solo mediante la función crear_empresa)

create policy usuarios_sel on usuarios for select using (
  id = auth.uid()
  or exists (select 1 from empresa_usuarios a join empresa_usuarios b on a.empresa_id = b.empresa_id
              where a.usuario_id = auth.uid() and b.usuario_id = usuarios.id and a.activo)
);
create policy usuarios_upd on usuarios for update using (id = auth.uid()) with check (id = auth.uid());

create policy eu_sel on empresa_usuarios for select using (es_miembro(empresa_id));
create policy eu_ins on empresa_usuarios for insert with check (es_admin(empresa_id) and rol <> 'propietario');
create policy eu_upd on empresa_usuarios for update using (es_admin(empresa_id) and rol <> 'propietario')
  with check (es_admin(empresa_id) and rol <> 'propietario');
create policy eu_del on empresa_usuarios for delete using (es_admin(empresa_id) and rol <> 'propietario');

create policy inv_all on invitaciones for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create policy mod_sel on modulos_empresa for select using (es_miembro(empresa_id));
create policy mod_wr  on modulos_empresa for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- ---------------------------------------------------------------------
-- CATÁLOGOS OPERATIVOS: todos los miembros leen, los gestores escriben
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fincas','propietarios_terceros','parcelas','recintos','campanas',
                           'recinto_cultivos','maquinaria','aperos','labores','clientes','productos',
                           'maquinaria_documentos','mantenimientos']
  loop
    execute format('create policy %I on %I for select using (es_miembro(empresa_id))', t||'_sel', t);
    execute format('create policy %I on %I for insert with check (es_gestor(empresa_id))', t||'_ins', t);
    execute format('create policy %I on %I for update using (es_gestor(empresa_id)) with check (es_gestor(empresa_id))', t||'_upd', t);
    execute format('create policy %I on %I for delete using (es_gestor(empresa_id))', t||'_del', t);
  end loop;
end $$;

create policy cultivos_sel on cultivos for select using (empresa_id is null or es_miembro(empresa_id));
create policy cultivos_wr  on cultivos for all using (empresa_id is not null and es_gestor(empresa_id))
  with check (empresa_id is not null and es_gestor(empresa_id));

-- Trabajadores: el gestor ve a todos; el trabajador solo su propia ficha
create policy trab_sel on trabajadores for select using (es_gestor(empresa_id) or usuario_id = auth.uid());
create policy trab_wr  on trabajadores for all using (es_gestor(empresa_id)) with check (es_gestor(empresa_id));

-- Averías: cualquiera puede avisar de una avería; el gestor gestiona
create policy av_sel on averias for select using (es_miembro(empresa_id));
create policy av_ins on averias for insert with check (es_miembro(empresa_id));
create policy av_upd on averias for update using (es_gestor(empresa_id)) with check (es_gestor(empresa_id));
create policy av_del on averias for delete using (es_gestor(empresa_id));

-- ---------------------------------------------------------------------
-- PARTES DE TRABAJO
-- ---------------------------------------------------------------------
create policy partes_sel on partes_trabajo for select
  using (es_gestor(empresa_id) or (es_miembro(empresa_id) and creado_por = auth.uid())
         or rol_en(empresa_id) = 'tecnico');
create policy partes_ins on partes_trabajo for insert
  with check (es_miembro(empresa_id) and rol_en(empresa_id) <> 'tecnico'
              and (es_gestor(empresa_id) or (creado_por = auth.uid() and estado <> 'validado')));
create policy partes_upd on partes_trabajo for update
  using (puede_editar_parte(id))
  with check (es_gestor(empresa_id) or (creado_por = auth.uid() and estado in ('en_curso','borrador','pendiente','descartado')));
create policy partes_del on partes_trabajo for delete using (puede_editar_parte(id));

do $$
declare t text;
begin
  foreach t in array array['partes_trabajo_recintos','partes_trabajo_trabajadores',
                           'partes_trabajo_maquinaria','partes_trabajo_aperos']
  loop
    execute format('create policy %I on %I for select using (exists (select 1 from partes_trabajo p where p.id = parte_trabajo_id))', t||'_sel', t);
    execute format('create policy %I on %I for insert with check (puede_editar_parte(parte_trabajo_id))', t||'_ins', t);
    execute format('create policy %I on %I for update using (puede_editar_parte(parte_trabajo_id)) with check (puede_editar_parte(parte_trabajo_id))', t||'_upd', t);
    execute format('create policy %I on %I for delete using (puede_editar_parte(parte_trabajo_id))', t||'_del', t);
  end loop;
end $$;

create policy apl_sel on aplicaciones for select using (exists (select 1 from partes_trabajo p where p.id = parte_trabajo_id));
create policy apl_wr  on aplicaciones for all using (puede_editar_parte(parte_trabajo_id)) with check (puede_editar_parte(parte_trabajo_id));

create policy aplp_sel on aplicaciones_productos for select
  using (exists (select 1 from aplicaciones a where a.id = aplicacion_id));
create policy aplp_wr on aplicaciones_productos for all
  using (exists (select 1 from aplicaciones a where a.id = aplicacion_id and puede_editar_parte(a.parte_trabajo_id)))
  with check (exists (select 1 from aplicaciones a where a.id = aplicacion_id and puede_editar_parte(a.parte_trabajo_id)));

-- ---------------------------------------------------------------------
-- ECONOMÍA: solo gestores
-- ---------------------------------------------------------------------
create policy prov_all on proveedores      for all using (es_gestor(empresa_id)) with check (es_gestor(empresa_id));
create policy alb_all  on albaranes_compra for all using (es_gestor(empresa_id)) with check (es_gestor(empresa_id));
create policy albl_all on albaranes_compra_lineas for all
  using (exists (select 1 from albaranes_compra a where a.id = albaran_id and es_gestor(a.empresa_id)))
  with check (exists (select 1 from albaranes_compra a where a.id = albaran_id and es_gestor(a.empresa_id)));
create policy stk_all  on stock_ajustes for all using (es_gestor(empresa_id)) with check (es_gestor(empresa_id));

create policy doc_sel on documentos for select using (es_gestor(empresa_id) or subido_por = auth.uid());
create policy doc_ins on documentos for insert with check (es_miembro(empresa_id));
create policy doc_upd on documentos for update using (es_gestor(empresa_id) or subido_por = auth.uid())
  with check (es_miembro(empresa_id));
create policy doc_del on documentos for delete using (es_gestor(empresa_id));

-- ---------------------------------------------------------------------
-- FOTOS, OBSERVACIONES, IA
-- ---------------------------------------------------------------------
create policy foto_sel on fotografias for select using (es_miembro(empresa_id));
create policy foto_ins on fotografias for insert with check (es_miembro(empresa_id));
create policy foto_upd on fotografias for update using (es_gestor(empresa_id) or subida_por = auth.uid());
create policy foto_del on fotografias for delete using (es_gestor(empresa_id) or subida_por = auth.uid());

create policy obs_sel on observaciones_agronomicas for select using (es_miembro(empresa_id));
create policy obs_ins on observaciones_agronomicas for insert with check (es_miembro(empresa_id));
create policy obs_upd on observaciones_agronomicas for update using (es_gestor(empresa_id) or creado_por = auth.uid());
create policy obs_del on observaciones_agronomicas for delete using (es_gestor(empresa_id) or creado_por = auth.uid());

create policy ia_sel on acciones_ia for select using (usuario_id = auth.uid() or es_admin(empresa_id));
create policy ia_ins on acciones_ia for insert with check (es_miembro(empresa_id) and usuario_id = auth.uid());
create policy ia_upd on acciones_ia for update using (usuario_id = auth.uid());

-- =====================================================================
-- ALTA AUTOMÁTICA DE PERFIL al registrarse en Supabase Auth
-- =====================================================================
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios (id, email, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- =====================================================================
-- RPC: crear_empresa — alta guiada en un solo paso (onboarding)
-- Crea empresa, te hace propietario, campaña activa, labores típicas,
-- tu ficha de trabajador y la maquinaria/aperos que marques.
-- =====================================================================
create or replace function crear_empresa(
  p_nombre     text,
  p_provincia  text default null,
  p_municipio  text default null,
  p_cultivos   text[] default array['Olivar'],
  p_maquinaria text[] default array[]::text[],
  p_aperos     text[] default array[]::text[],
  p_inicio_campana date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_emp uuid;
  v_nombre text;
  v_ini date;
  v_m text;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'El nombre es obligatorio'; end if;

  insert into usuarios (id, email) select v_uid, email from auth.users where id = v_uid
  on conflict (id) do nothing;

  insert into empresas (nombre, provincia, municipio, comunidad_autonoma)
  values (trim(p_nombre), p_provincia, p_municipio, null)
  returning id into v_emp;

  insert into empresa_usuarios (empresa_id, usuario_id, rol) values (v_emp, v_uid, 'propietario');
  update usuarios set empresa_activa_id = v_emp where id = v_uid;

  insert into modulos_empresa (empresa_id, modulo)
  select v_emp, m from unnest(array['territorio','operaciones','maquinaria','productos','cuaderno','compras','ia']) m;

  -- Campaña: por defecto año natural; olivar suele usar 1 oct – 30 sep
  v_ini := coalesce(p_inicio_campana, make_date(extract(year from current_date)::int, 1, 1));
  if v_ini > current_date then v_ini := (v_ini - interval '1 year')::date; end if;
  insert into campanas (empresa_id, nombre, fecha_inicio, fecha_fin, activa)
  values (v_emp,
          case when extract(month from v_ini) = 1 then 'Campaña ' || extract(year from v_ini)
               else 'Campaña ' || extract(year from v_ini) || '/' || (extract(year from v_ini)+1) end,
          v_ini, (v_ini + interval '1 year' - interval '1 day')::date, true);

  -- Ficha de trabajador del propio titular
  select coalesce(nombre, split_part(email,'@',1)) into v_nombre from usuarios where id = v_uid;
  insert into trabajadores (empresa_id, usuario_id, nombre, tipo_trabajador, coste_hora)
  values (v_emp, v_uid, coalesce(v_nombre,'Titular'), 'propietario', 0);

  -- Cultivos propios si no están en el catálogo global
  insert into cultivos (empresa_id, nombre)
  select v_emp, c from unnest(p_cultivos) c
   where not exists (select 1 from cultivos where empresa_id is null and lower(nombre) = lower(c));

  foreach v_m in array p_maquinaria loop
    insert into maquinaria (empresa_id, nombre, tipo) values (v_emp, v_m, lower(split_part(v_m,' ',1)));
  end loop;
  foreach v_m in array p_aperos loop
    insert into aperos (empresa_id, nombre, tipo) values (v_emp, v_m, lower(split_part(v_m,' ',1)));
  end loop;

  -- Labores típicas (editables). Palabras clave para que el asistente las reconozca.
  insert into labores (empresa_id, nombre, categoria, requiere_maquinaria, palabras_clave) values
    (v_emp,'Cultivador','labor',true,array['cultivador','cultivar','labrar','arar']),
    (v_emp,'Rastra','labor',true,array['rastra','rastrear','grada']),
    (v_emp,'Desbrozadora','labor',true,array['desbrozar','desbrozadora','triturar','picar ramón']),
    (v_emp,'Tratamiento fitosanitario','tratamiento',true,array['tratar','tratamiento','fumigar','sulfatar','atomizador','cobre']),
    (v_emp,'Tratamiento herbicida con cuba','herbicida',true,array['herbicida','cuba','echar herbicida']),
    (v_emp,'Tratamiento herbicida con mochila','herbicida',false,array['mochila']),
    (v_emp,'Abonado al suelo','fertilizacion',true,array['abonar','abono','fertilizar','echar abono']),
    (v_emp,'Abonado foliar','fertilizacion',true,array['foliar']),
    (v_emp,'Poda','poda',false,array['podar','poda','motosierra']),
    (v_emp,'Riego','riego',false,array['regar','riego']),
    (v_emp,'Recolección','recoleccion',true,array['recoger','recolección','vibrar','vibrador','cosecha','aceituna']),
    (v_emp,'Transporte','transporte',true,array['transporte','remolque','llevar','almazara']),
    (v_emp,'Otros trabajos','otro',false,array['otro'])
  on conflict do nothing;

  -- Maquinaria y aperos habituales por labor (si existen con ese nombre)
  update labores l set maquinaria_habitual_id = (select id from maquinaria m where m.empresa_id = v_emp and m.tipo = 'tractor' order by created_at limit 1)
   where l.empresa_id = v_emp and l.requiere_maquinaria;
  update labores l set apero_habitual_id = a.id
    from aperos a
   where a.empresa_id = v_emp and l.empresa_id = v_emp and (
         (l.nombre = 'Cultivador' and a.nombre ilike '%cultivador%') or
         (l.nombre = 'Rastra' and a.nombre ilike '%rastra%') or
         (l.nombre = 'Desbrozadora' and a.nombre ilike '%desbroz%') or
         (l.nombre = 'Tratamiento fitosanitario' and a.nombre ilike '%atomizador%') or
         (l.nombre = 'Tratamiento herbicida con cuba' and a.nombre ilike '%cuba%') or
         (l.nombre = 'Abonado al suelo' and a.nombre ilike '%abonadora%') or
         (l.nombre = 'Recolección' and a.nombre ilike '%vibrador%') or
         (l.nombre = 'Transporte' and a.nombre ilike '%remolque%'));
  -- Si el atomizador/vibrador se dio de alta como máquina, úsalo como habitual
  update labores l set maquinaria_habitual_id = m.id
    from maquinaria m
   where m.empresa_id = v_emp and l.empresa_id = v_emp and l.apero_habitual_id is null and (
         (l.nombre = 'Tratamiento fitosanitario' and m.nombre ilike '%atomizador%') or
         (l.nombre = 'Recolección' and m.nombre ilike '%vibrador%'));

  return v_emp;
end $$;

-- =====================================================================
-- RPC: aceptar_invitaciones — se llama al iniciar sesión
-- =====================================================================
create or replace function aceptar_invitaciones() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  r record;
  n int := 0;
begin
  if v_uid is null then return 0; end if;
  select email into v_email from auth.users where id = v_uid;
  insert into usuarios (id, email) values (v_uid, v_email) on conflict (id) do nothing;

  for r in select * from invitaciones where lower(email) = lower(v_email) and not aceptada loop
    insert into empresa_usuarios (empresa_id, usuario_id, rol)
    values (r.empresa_id, v_uid, r.rol)
    on conflict (empresa_id, usuario_id) do update set activo = true, rol = excluded.rol;

    if r.trabajador_id is not null then
      update trabajadores set usuario_id = v_uid where id = r.trabajador_id and usuario_id is null;
    elsif r.rol in ('trabajador','encargado') and not exists
          (select 1 from trabajadores where empresa_id = r.empresa_id and usuario_id = v_uid) then
      insert into trabajadores (empresa_id, usuario_id, nombre, email, tipo_trabajador)
      values (r.empresa_id, v_uid, split_part(v_email,'@',1), v_email, 'fijo');
    end if;

    update invitaciones set aceptada = true where id = r.id;
    update usuarios set empresa_activa_id = coalesce(empresa_activa_id, r.empresa_id) where id = v_uid;
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================
-- RPC: guardar_parte — crea o actualiza un parte completo en una sola
-- transacción (recintos, trabajadores, máquinas, aperos y aplicación).
-- Idempotente con id_local (sincronización offline sin duplicados).
-- Se ejecuta con los permisos del usuario (RLS aplica).
--
-- payload = {
--   id?, empresa_id, id_local?, labor_id?, fecha?, inicio?, fin?, horas_totales?,
--   estado?, origen?, observaciones?, gps_inicio?, gps_fin?, recorrido?,
--   tipo_trabajo?, cliente_id?, precio_terceros?,
--   recinto_ids: [], trabajador_ids: [], maquinaria_ids: [], apero_ids: [],
--   aplicacion?: { tipo, plaga_o_motivo, volumen_caldo_l_ha,
--                  productos: [{producto_id, dosis_ha, unidad_dosis, cantidad_total?}] }
-- }
-- =====================================================================
create or replace function guardar_parte(payload jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_emp   uuid := (payload->>'empresa_id')::uuid;
  v_id    uuid := nullif(payload->>'id','')::uuid;
  v_estado text := coalesce(payload->>'estado', 'pendiente');
  v_sup   numeric;
  v_apl   uuid;
  v_trab  uuid[];
  p jsonb;
begin
  if v_emp is null then raise exception 'empresa_id obligatorio'; end if;
  if not es_miembro(v_emp) then raise exception 'Sin acceso a esta empresa'; end if;
  -- Un trabajador nunca valida su propio parte (FLUJO-061)
  if not es_gestor(v_emp) and v_estado = 'validado' then v_estado := 'pendiente'; end if;

  -- Idempotencia offline
  if v_id is null and payload ? 'id_local' then
    select id into v_id from partes_trabajo where empresa_id = v_emp and id_local = payload->>'id_local';
    if v_id is not null and not (payload ? 'forzar_actualizacion') then return v_id; end if;
  end if;

  if v_id is null then
    insert into partes_trabajo (empresa_id, labor_id, fecha, inicio, fin, horas_totales, estado, origen,
      observaciones, gps_inicio, gps_fin, recorrido, tipo_trabajo, cliente_id, precio_terceros, id_local)
    values (v_emp, nullif(payload->>'labor_id','')::uuid,
      coalesce(nullif(payload->>'fecha','')::date, current_date),
      nullif(payload->>'inicio','')::timestamptz, nullif(payload->>'fin','')::timestamptz,
      nullif(payload->>'horas_totales','')::numeric, v_estado, coalesce(payload->>'origen','manual'),
      payload->>'observaciones', payload->'gps_inicio', payload->'gps_fin', payload->'recorrido',
      coalesce(payload->>'tipo_trabajo','propio'), nullif(payload->>'cliente_id','')::uuid,
      nullif(payload->>'precio_terceros','')::numeric, payload->>'id_local')
    returning id into v_id;
  else
    update partes_trabajo set
      labor_id      = nullif(payload->>'labor_id','')::uuid,
      fecha         = coalesce(nullif(payload->>'fecha','')::date, fecha),
      inicio        = coalesce(nullif(payload->>'inicio','')::timestamptz, inicio),
      fin           = nullif(payload->>'fin','')::timestamptz,
      horas_totales = coalesce(nullif(payload->>'horas_totales','')::numeric, horas_totales),
      estado        = v_estado,
      observaciones = payload->>'observaciones',
      gps_fin       = coalesce(payload->'gps_fin', gps_fin),
      recorrido     = coalesce(payload->'recorrido', recorrido),
      tipo_trabajo  = coalesce(payload->>'tipo_trabajo', tipo_trabajo),
      cliente_id    = nullif(payload->>'cliente_id','')::uuid,
      precio_terceros = nullif(payload->>'precio_terceros','')::numeric
    where id = v_id;
    if not found then raise exception 'Parte no encontrado o sin permiso'; end if;
    delete from partes_trabajo_recintos     where parte_trabajo_id = v_id;
    delete from partes_trabajo_trabajadores where parte_trabajo_id = v_id;
    delete from partes_trabajo_maquinaria   where parte_trabajo_id = v_id;
    delete from partes_trabajo_aperos       where parte_trabajo_id = v_id;
    delete from aplicaciones                where parte_trabajo_id = v_id;
  end if;

  -- Si se dan horas pero no inicio/fin, respétalas
  if payload ? 'horas_totales' and nullif(payload->>'horas_totales','') is not null then
    update partes_trabajo set horas_totales = (payload->>'horas_totales')::numeric
     where id = v_id and (inicio is null or fin is null);
  end if;

  insert into partes_trabajo_recintos (parte_trabajo_id, recinto_id, superficie_trabajada_ha, detectado_gps)
  select v_id, r.id, r.superficie_sigpac_ha, coalesce((payload->>'detectado_gps')::boolean, false)
    from recintos r
   where r.empresa_id = v_emp
     and r.id in (select (jsonb_array_elements_text(coalesce(payload->'recinto_ids','[]'::jsonb)))::uuid);

  select array_agg(x::uuid) into v_trab
    from jsonb_array_elements_text(coalesce(payload->'trabajador_ids','[]'::jsonb)) x;
  if v_trab is null or array_length(v_trab,1) is null then
    -- Por defecto: quien registra el parte
    select array_agg(id) into v_trab from trabajadores where empresa_id = v_emp and usuario_id = auth.uid();
  end if;
  insert into partes_trabajo_trabajadores (parte_trabajo_id, trabajador_id)
  select v_id, t from unnest(coalesce(v_trab, array[]::uuid[])) t;

  insert into partes_trabajo_maquinaria (parte_trabajo_id, maquinaria_id)
  select v_id, (x)::uuid from jsonb_array_elements_text(coalesce(payload->'maquinaria_ids','[]'::jsonb)) x;

  insert into partes_trabajo_aperos (parte_trabajo_id, apero_id)
  select v_id, (x)::uuid from jsonb_array_elements_text(coalesce(payload->'apero_ids','[]'::jsonb)) x;

  -- Aplicación de productos (genera cuaderno de campo y consume stock lógico)
  if payload ? 'aplicacion' and jsonb_typeof(payload->'aplicacion') = 'object'
     and jsonb_array_length(coalesce(payload->'aplicacion'->'productos','[]'::jsonb)) > 0 then
    select coalesce(sum(superficie_trabajada_ha),0) into v_sup from partes_trabajo_recintos where parte_trabajo_id = v_id;
    insert into aplicaciones (empresa_id, parte_trabajo_id, tipo, plaga_o_motivo, volumen_caldo_l_ha)
    values (v_emp, v_id, coalesce(payload->'aplicacion'->>'tipo','fitosanitario'),
            payload->'aplicacion'->>'plaga_o_motivo',
            nullif(payload->'aplicacion'->>'volumen_caldo_l_ha','')::numeric)
    returning id into v_apl;
    for p in select * from jsonb_array_elements(payload->'aplicacion'->'productos') loop
      insert into aplicaciones_productos (aplicacion_id, producto_id, dosis_ha, unidad_dosis, cantidad_total)
      values (v_apl, (p->>'producto_id')::uuid, nullif(p->>'dosis_ha','')::numeric, p->>'unidad_dosis',
              coalesce(nullif(p->>'cantidad_total','')::numeric,
                       round(nullif(p->>'dosis_ha','')::numeric * nullif(v_sup,0), 3)));
    end loop;
  end if;

  if es_gestor(v_emp) and v_estado = 'validado' then
    update partes_trabajo set validado_por = auth.uid(), validado_en = now()
     where id = v_id and validado_por is null;
  end if;

  return v_id;
end $$;

-- =====================================================================
-- RPC: validar_partes — el titular valida en bloque (FLUJO-061)
-- =====================================================================
create or replace function validar_partes(p_ids uuid[]) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  update partes_trabajo set estado = 'validado', validado_por = auth.uid(), validado_en = now()
   where id = any(p_ids) and es_gestor(empresa_id) and estado in ('pendiente','borrador');
  get diagnostics n = row_count;
  return n;
end $$;

-- =====================================================================
-- RPC: registrar_albaran — guarda la propuesta (normalmente leída por IA)
-- creando proveedor y productos nuevos si no existen.
-- payload = { empresa_id, documento_id?, proveedor_nombre, proveedor_nif?, numero, fecha,
--             base_imponible?, iva?, total?, con_factura?,
--             lineas: [{producto_id?, producto_nombre?, tipo?, unidad?, descripcion,
--                       cantidad, precio_unitario, importe}] }
-- =====================================================================
create or replace function registrar_albaran(payload jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_emp  uuid := (payload->>'empresa_id')::uuid;
  v_prov uuid;
  v_alb  uuid;
  v_prod uuid;
  l jsonb;
begin
  if not es_gestor(v_emp) then raise exception 'Solo el titular o encargado puede registrar compras'; end if;

  if coalesce(trim(payload->>'proveedor_nombre'),'') <> '' then
    select id into v_prov from proveedores
     where empresa_id = v_emp and lower(nombre) = lower(trim(payload->>'proveedor_nombre'));
    if v_prov is null then
      insert into proveedores (empresa_id, nombre, nif)
      values (v_emp, trim(payload->>'proveedor_nombre'), payload->>'proveedor_nif')
      returning id into v_prov;
    end if;
  end if;

  insert into albaranes_compra (empresa_id, proveedor_id, documento_id, numero, fecha,
                                base_imponible, iva, total, con_factura, observaciones)
  values (v_emp, v_prov, nullif(payload->>'documento_id','')::uuid, payload->>'numero',
          coalesce(nullif(payload->>'fecha','')::date, current_date),
          nullif(payload->>'base_imponible','')::numeric, nullif(payload->>'iva','')::numeric,
          nullif(payload->>'total','')::numeric, coalesce((payload->>'con_factura')::boolean, true),
          payload->>'observaciones')
  returning id into v_alb;

  for l in select * from jsonb_array_elements(coalesce(payload->'lineas','[]'::jsonb)) loop
    v_prod := nullif(l->>'producto_id','')::uuid;
    if v_prod is null and coalesce(trim(l->>'producto_nombre'),'') <> '' then
      select id into v_prod from productos
       where empresa_id = v_emp and lower(nombre) = lower(trim(l->>'producto_nombre'));
      if v_prod is null then
        insert into productos (empresa_id, nombre, tipo, unidad)
        values (v_emp, trim(l->>'producto_nombre'), coalesce(nullif(l->>'tipo',''),'otro'),
                coalesce(nullif(l->>'unidad',''),'kg'))
        returning id into v_prod;
      end if;
    end if;
    insert into albaranes_compra_lineas (albaran_id, producto_id, descripcion, cantidad, unidad, precio_unitario, importe)
    values (v_alb, v_prod, coalesce(l->>'descripcion', l->>'producto_nombre', 'Línea'),
            nullif(l->>'cantidad','')::numeric, l->>'unidad',
            nullif(l->>'precio_unitario','')::numeric, nullif(l->>'importe','')::numeric);
  end loop;

  if payload ? 'documento_id' and nullif(payload->>'documento_id','') is not null then
    update documentos set estado_ia = 'validado' where id = (payload->>'documento_id')::uuid;
  end if;
  return v_alb;
end $$;

-- Permisos de ejecución
revoke all on function crear_empresa(text,text,text,text[],text[],text[],date) from public;
grant execute on function crear_empresa(text,text,text,text[],text[],text[],date) to authenticated;
grant execute on function aceptar_invitaciones() to authenticated;
grant execute on function guardar_parte(jsonb) to authenticated;
grant execute on function validar_partes(uuid[]) to authenticated;
grant execute on function registrar_albaran(jsonb) to authenticated;
