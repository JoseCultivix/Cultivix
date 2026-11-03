-- =====================================================================
-- 0009 · Registro de fitosanitarios (MAPA), plazos de seguridad, riegos
--         y panel para técnicos con varias explotaciones
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Catálogo del Registro de Productos Fitosanitarios (datos públicos del MAPA)
--    Lo rellena y actualiza la función «actualizar-fitos» cada semana.
-- ---------------------------------------------------------------------
create or replace function fito_norm_registro(t text) returns text
language sql immutable parallel safe as $$
  select nullif(regexp_replace(regexp_replace(upper(coalesce(t,'')), '[^A-Z0-9]', '', 'g'), '^([A-Z]*)0+(?=\d)', '\1'), '')
$$;

-- Código de cultivo del MAPA (16 cifras, 8 niveles de 2) sin los niveles vacíos del final
create or replace function fito_prefijo(c text) returns text
language plpgsql immutable parallel safe as $$
declare i int;
begin
  if c is null or length(c) <> 16 then return c; end if;
  for i in reverse 8..1 loop
    if substr(c, i*2-1, 2) <> '00' then return left(c, i*2); end if;
  end loop;
  return '';
end $$;

-- Relación entre el cultivo de un uso autorizado y el de la parcela:
-- 'igual', 'superior' (el uso es de un grupo que incluye al cultivo: vale),
-- 'inferior' (el uso es de un tipo concreto del cultivo: vale solo para ese tipo)
create or replace function fito_relacion(codigo_uso text, codigo_cultivo text) returns text
language sql immutable parallel safe as $$
  select case
    when codigo_uso is null or codigo_cultivo is null then null
    when fito_prefijo(codigo_uso) = fito_prefijo(codigo_cultivo) then 'igual'
    when starts_with(fito_prefijo(codigo_cultivo), fito_prefijo(codigo_uso)) then 'superior'
    when starts_with(fito_prefijo(codigo_uso), fito_prefijo(codigo_cultivo)) then 'inferior'
  end
$$;

create table if not exists fito_info (clave text primary key, valor text not null);

create table if not exists fito_productos (
  id            integer primary key,          -- IdProducto del MAPA
  registro      text not null,
  registro_n    text generated always as (fito_norm_registro(registro)) stored,
  nombre        text not null,
  titular       text,
  formulado     text,                         -- composición (sustancias y %)
  estado        text not null,
  caducidad     date,
  cancelacion   date,
  limite_venta  date
);
create index if not exists idx_fito_prod_reg on fito_productos(registro_n);
create index if not exists idx_fito_prod_nombre on fito_productos(lower(nombre));

create table if not exists fito_cultivos (id bigint primary key, codigo text not null unique, nombre text not null);
create table if not exists fito_agentes (id bigint primary key, codigo text not null unique, nombre text not null, tipo text);

create table if not exists fito_usos (
  producto_id  integer not null,
  cultivo_id   bigint not null,
  agente_id    bigint not null,
  dosis_min    numeric,
  dosis_max    numeric,
  unidad       text,
  plazo        text,
  plazo_dias   integer,
  aplicaciones text,
  intervalo    text,
  caldo        text,
  ambito       text,
  sistema      text,
  metodo       text,
  lote         text not null                 -- fecha de los datos del MAPA
);
create index if not exists idx_fito_usos_prod on fito_usos(producto_id);
create index if not exists idx_fito_usos_lote on fito_usos(lote);

alter table fito_info enable row level security;
alter table fito_productos enable row level security;
alter table fito_cultivos enable row level security;
alter table fito_agentes enable row level security;
alter table fito_usos enable row level security;
drop policy if exists fito_info_sel on fito_info;
drop policy if exists fito_prod_sel on fito_productos;
drop policy if exists fito_cult_sel on fito_cultivos;
drop policy if exists fito_ag_sel on fito_agentes;
drop policy if exists fito_usos_sel on fito_usos;
create policy fito_info_sel on fito_info for select to authenticated using (true);
create policy fito_prod_sel on fito_productos for select to authenticated using (true);
create policy fito_cult_sel on fito_cultivos for select to authenticated using (true);
create policy fito_ag_sel on fito_agentes for select to authenticated using (true);
create policy fito_usos_sel on fito_usos for select to authenticated using (true);
-- Solo la función de carga (service role) escribe en el catálogo.

-- Cultivos de Cultivix ↔ cultivo del Registro
alter table cultivos add column if not exists codigo_mapa text;
update cultivos set codigo_mapa = v.c from (values
  ('Olivar','0101020200000000'), ('Pistacho','0101020604000000'), ('Almendro','0101020601000000'),
  ('Espárrago verde','0103010901000000'), ('Viñedo','0101020700000000'), ('Cereal','0102020000000000'),
  ('Cítricos','0101020100000000'), ('Frutales','0101020000000000'), ('Hortícolas','0103010000000000'),
  ('Barbecho','0105000000000000')) v(n, c)
where cultivos.empresa_id is null and cultivos.nombre = v.n and cultivos.codigo_mapa is null;

-- Usos autorizados de un producto (por nº de registro) en unos cultivos
create or replace function fito_usos_para(p_registro text, p_codigos text[])
returns table (
  codigo_cultivo text, relacion text, cultivo_uso text, agente text, tipo_agente text,
  dosis_min numeric, dosis_max numeric, unidad text, plazo text, plazo_dias integer,
  aplicaciones text, intervalo text, caldo text, ambito text, metodo text,
  producto text, registro text, formulado text, estado text, caducidad date, cancelacion date, limite_venta date
)
language sql stable security invoker set search_path = public as $$
  select c.codigo, fito_relacion(fc.codigo, c.codigo), fc.nombre, fa.nombre, fa.tipo,
         u.dosis_min, u.dosis_max, u.unidad, u.plazo, u.plazo_dias, u.aplicaciones, u.intervalo, u.caldo, u.ambito, u.metodo,
         fp.nombre, fp.registro, fp.formulado, fp.estado, fp.caducidad, fp.cancelacion, fp.limite_venta
  from fito_productos fp
  join fito_usos u on u.producto_id = fp.id
  join fito_cultivos fc on fc.id = u.cultivo_id
  join fito_agentes fa on fa.id = u.agente_id
  cross join unnest(p_codigos) c(codigo)
  where fp.registro_n = fito_norm_registro(p_registro)
    and fito_relacion(fc.codigo, c.codigo) is not null
  order by 1, 2, 4
$$;

-- Datos del producto en el Registro aunque no tenga usos en esos cultivos
create or replace function fito_producto(p_registro text)
returns table (id integer, producto text, registro text, formulado text, titular text, estado text,
               caducidad date, cancelacion date, limite_venta date, fecha_datos text)
language sql stable security invoker set search_path = public as $$
  select fp.id, fp.nombre, fp.registro, fp.formulado, fp.titular, fp.estado, fp.caducidad, fp.cancelacion, fp.limite_venta,
         (select valor from fito_info where clave = 'fecha_datos')
  from fito_productos fp where fp.registro_n = fito_norm_registro(p_registro)
  order by (fp.estado = 'Vigente') desc limit 1
$$;

-- Buscador para dar de alta un producto desde el Registro
create or replace function fito_buscar(p_texto text, p_codigo_cultivo text default null)
returns table (registro text, producto text, formulado text, titular text, estado text, en_cultivo boolean)
language sql stable security invoker set search_path = public as $$
  select fp.registro, fp.nombre, fp.formulado, fp.titular, fp.estado,
         case when p_codigo_cultivo is null then null else exists (
           select 1 from fito_usos u join fito_cultivos fc on fc.id = u.cultivo_id
            where u.producto_id = fp.id and fito_relacion(fc.codigo, p_codigo_cultivo) in ('igual','superior','inferior')) end
  from fito_productos fp
  where length(trim(coalesce(p_texto,''))) >= 2
    and (fp.nombre ilike '%' || trim(p_texto) || '%' or fp.registro_n = fito_norm_registro(p_texto)
         or fp.formulado ilike '%' || trim(p_texto) || '%')
  order by (fp.estado = 'Vigente') desc, (fp.registro_n = fito_norm_registro(p_texto)) desc, length(fp.nombre)
  limit 20
$$;

revoke execute on function fito_usos_para(text, text[]), fito_producto(text), fito_buscar(text, text) from public, anon;
grant execute on function fito_usos_para(text, text[]), fito_producto(text), fito_buscar(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Plazos de seguridad en curso por recinto
--    Plazo = el mayor de los usos autorizados del producto en ese cultivo
--    (criterio prudente); si no está en el Registro, el de la ficha del producto.
-- ---------------------------------------------------------------------
create or replace view v_plazos_seguridad with (security_invoker = true) as
with apl as (
  select p.empresa_id, p.id as parte_trabajo_id, ptr.recinto_id, r.parcela_id, pa.nombre as parcela, p.fecha,
         pr.id as producto_id, pr.nombre as producto, pr.numero_registro, pr.plazo_seguridad_dias,
         (select cu.codigo_mapa from cultivos cu where cu.id = cultivo_de_recinto(r.id, p.fecha)) as codigo_cultivo,
         (select cu.nombre from cultivos cu where cu.id = cultivo_de_recinto(r.id, p.fecha)) as cultivo
  from partes_trabajo p
  join aplicaciones a on a.parte_trabajo_id = p.id
  join aplicaciones_productos ap on ap.aplicacion_id = a.id
  join productos pr on pr.id = ap.producto_id
  join partes_trabajo_recintos ptr on ptr.parte_trabajo_id = p.id
  join recintos r on r.id = ptr.recinto_id
  join parcelas pa on pa.id = r.parcela_id
  where p.estado in ('validado','pendiente')
    and p.fecha >= current_date - 400
    and (pr.tipo in ('fitosanitario','herbicida') or a.tipo in ('fitosanitario','herbicida'))
), con_plazo as (
  select apl.*,
    coalesce(
      (select max(u.plazo_dias) from fito_productos fp join fito_usos u on u.producto_id = fp.id join fito_cultivos fc on fc.id = u.cultivo_id
        where fp.registro_n = fito_norm_registro(apl.numero_registro) and fito_relacion(fc.codigo, apl.codigo_cultivo) in ('igual','superior')),
      (select max(u.plazo_dias) from fito_productos fp join fito_usos u on u.producto_id = fp.id join fito_cultivos fc on fc.id = u.cultivo_id
        where fp.registro_n = fito_norm_registro(apl.numero_registro) and fito_relacion(fc.codigo, apl.codigo_cultivo) = 'inferior'),
      apl.plazo_seguridad_dias) as plazo_dias
  from apl
)
-- fecha_segura = primer día en que se puede cosechar
select *, fecha + plazo_dias as fecha_segura,
       case when (select 1 from fito_productos fp where fp.registro_n = fito_norm_registro(con_plazo.numero_registro) limit 1) is not null
            then 'registro' else 'ficha' end as origen_plazo
from con_plazo
where plazo_dias is not null and plazo_dias > 0;

-- Avisos de Inicio: se añaden los plazos de seguridad vigentes
create or replace view v_alertas with (security_invoker = true) as
select d.empresa_id, 'documento_maquinaria'::text as tipo,
  case when d.fecha_caducidad < current_date then 'alta' else 'media' end as prioridad,
  upper(d.tipo_documento) || ' ' || coalesce(m.nombre, ap.nombre) ||
    case when d.fecha_caducidad < current_date then ' caducó hace ' || (current_date - d.fecha_caducidad) || ' días'
         else ' vence en ' || (d.fecha_caducidad - current_date) || ' días' end as texto,
  d.fecha_caducidad as fecha, '/maquinaria'::text as enlace
from maquinaria_documentos d
left join maquinaria m on m.id = d.maquinaria_id
left join aperos ap on ap.id = d.apero_id
where d.fecha_caducidad is not null and d.fecha_caducidad <= current_date + d.dias_aviso
union all
select empresa_id, 'partes_pendientes', 'media',
  count(*) || case when count(*) = 1 then ' parte pendiente de validar' else ' partes pendientes de validar' end,
  min(fecha), '/partes'
from partes_trabajo where estado = 'pendiente' group by empresa_id
union all
select empresa_id, 'trabajo_en_curso', 'media',
  'Tienes ' || count(*) || ' trabajo(s) sin cerrar', min(fecha), '/trabajo'
from partes_trabajo where estado = 'en_curso' and creado_por = auth.uid() group by empresa_id
union all
select s.empresa_id, 'stock_negativo', 'baja',
  'Stock negativo de ' || s.nombre || ' (' || round(s.stock,2) || ' ' || s.unidad || '): falta registrar una compra',
  null::date, '/productos'
from v_stock_productos s where s.stock < 0
union all
select empresa_id, 'cosecha_sin_liquidar', 'baja',
  count(*) || ' entrega(s) de cosecha sin precio desde hace más de 60 días', min(fecha), '/cosechas'
from entregas_cosecha where precio is null and fecha < current_date - 60 group by empresa_id
union all
select x.empresa_id, 'plazo_seguridad', 'alta',
  'No cosechar ' || x.parcela || ' antes del ' || to_char(x.fecha_segura, 'DD/MM') || ' (plazo de seguridad de ' || x.producto || ')',
  x.fecha_segura, '/plazos'
from (
  select distinct on (recinto_id) empresa_id, recinto_id, parcela, producto, fecha_segura
  from v_plazos_seguridad where fecha_segura > current_date
  order by recinto_id, fecha_segura desc
) x;

-- ---------------------------------------------------------------------
-- 3. Riegos (RD 1051/2022: dosis y fecha de riego en el cuaderno)
-- ---------------------------------------------------------------------
create table if not exists riegos_parte (
  parte_trabajo_id uuid primary key references partes_trabajo(id) on delete cascade,
  sistema          text check (sistema in ('goteo','aspersion','microaspersion','gravedad','pivot','otro')),
  m3_ha            numeric(10,2) check (m3_ha >= 0),
  volumen_m3       numeric(12,2) check (volumen_m3 >= 0),
  origen_agua      text,
  fertirrigacion   boolean not null default false,
  created_at       timestamptz not null default now()
);
alter table riegos_parte enable row level security;
drop policy if exists riego_sel on riegos_parte;
drop policy if exists riego_wr on riegos_parte;
create policy riego_sel on riegos_parte for select using (exists (select 1 from partes_trabajo p where p.id = parte_trabajo_id));
create policy riego_wr  on riegos_parte for all using (puede_editar_parte(parte_trabajo_id)) with check (puede_editar_parte(parte_trabajo_id));

create or replace view v_cuaderno_riego with (security_invoker = true) as
select p.empresa_id, p.id as parte_trabajo_id, p.fecha, ptr.campana_id, ptr.recinto_id, pa.nombre as parcela,
  r.referencia_sigpac, coalesce(ptr.superficie_trabajada_ha, r.superficie_sigpac_ha) as superficie_ha,
  (select cu.nombre from cultivos cu where cu.id = cultivo_de_recinto(r.id, p.fecha)) as cultivo,
  rg.sistema, rg.origen_agua, rg.fertirrigacion, p.horas_totales,
  coalesce(rg.m3_ha, rg.volumen_m3 / nullif(sum(coalesce(ptr.superficie_trabajada_ha, r.superficie_sigpac_ha, 0)) over (partition by p.id), 0)) as m3_ha,
  round(coalesce(rg.m3_ha, rg.volumen_m3 / nullif(sum(coalesce(ptr.superficie_trabajada_ha, r.superficie_sigpac_ha, 0)) over (partition by p.id), 0))
        * coalesce(ptr.superficie_trabajada_ha, r.superficie_sigpac_ha, 0), 2) as m3_recinto,
  p.estado
from partes_trabajo p
join riegos_parte rg on rg.parte_trabajo_id = p.id
join partes_trabajo_recintos ptr on ptr.parte_trabajo_id = p.id
join recintos r on r.id = ptr.recinto_id
join parcelas pa on pa.id = r.parcela_id
where p.estado in ('validado','pendiente');

-- ---------------------------------------------------------------------
-- 4. Panel del técnico: resumen de todas sus explotaciones
--    (security invoker: cada dato pasa por los permisos de su rol)
-- ---------------------------------------------------------------------
create or replace function panel_explotaciones()
returns table (
  empresa_id uuid, nombre text, rol text, municipio text, provincia text,
  hectareas numeric, recintos bigint, tratamientos_30d bigint, ultimo_tratamiento date,
  partes_pendientes bigint, plazos_activos bigint, recintos_exceso bigint, campanas_sin_plan bigint
)
language sql stable security invoker set search_path = public as $$
  select e.id, e.nombre, eu.rol, e.municipio, e.provincia,
    (select round(sum(coalesce(r.superficie_sigpac_ha,0)), 2) from recintos r where r.empresa_id = e.id and r.activo),
    (select count(*) from recintos r where r.empresa_id = e.id and r.activo),
    (select count(distinct c.parte_trabajo_id) from v_cuaderno_campo c where c.empresa_id = e.id and c.fecha >= current_date - 30),
    (select max(c.fecha) from v_cuaderno_campo c where c.empresa_id = e.id),
    (select count(*) from partes_trabajo p where p.empresa_id = e.id and p.estado = 'pendiente'),
    (select count(distinct v.recinto_id) from v_plazos_seguridad v where v.empresa_id = e.id and v.fecha_segura > current_date),
    (select count(*) from v_fertilizacion_recintos f where f.empresa_id = e.id
       and ((f.n_max_kg_ha is not null and f.n_aplicado_kg_ha > f.n_max_kg_ha)
         or (f.p2o5_max_kg_ha is not null and f.p2o5_aplicado_kg_ha > f.p2o5_max_kg_ha)
         or (f.zona_vulnerable and f.n_organico_kg_ha > 170))),
    (select count(*) from campanas c where c.empresa_id = e.id and c.activa
       and not exists (select 1 from planes_abonado pl where pl.campana_id = c.id and pl.recinto_id is null))
  from empresa_usuarios eu
  join empresas e on e.id = eu.empresa_id
  where eu.usuario_id = auth.uid() and eu.activo
  order by e.nombre
$$;
revoke execute on function panel_explotaciones() from public, anon;
grant execute on function panel_explotaciones() to authenticated;

-- Las campañas activas que no son de la explotación no entran: la consulta pasa por RLS.

-- 5. guardar_parte acepta el riego
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
    delete from riegos_parte                where parte_trabajo_id = v_id;
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
    insert into aplicaciones (empresa_id, parte_trabajo_id, tipo, plaga_o_motivo, volumen_caldo_l_ha,
                             metodo_aplicacion, eficacia, justificacion)
    values (v_emp, v_id, coalesce(payload->'aplicacion'->>'tipo','fitosanitario'),
            payload->'aplicacion'->>'plaga_o_motivo',
            nullif(payload->'aplicacion'->>'volumen_caldo_l_ha','')::numeric,
            nullif(payload->'aplicacion'->>'metodo_aplicacion',''),
            nullif(payload->'aplicacion'->>'eficacia',''),
            nullif(payload->'aplicacion'->>'justificacion',''))
    returning id into v_apl;
    for p in select * from jsonb_array_elements(payload->'aplicacion'->'productos') loop
      insert into aplicaciones_productos (aplicacion_id, producto_id, dosis_ha, unidad_dosis, cantidad_total)
      values (v_apl, (p->>'producto_id')::uuid, nullif(p->>'dosis_ha','')::numeric, p->>'unidad_dosis',
              coalesce(nullif(p->>'cantidad_total','')::numeric,
                       round(nullif(p->>'dosis_ha','')::numeric * nullif(v_sup,0), 3)));
    end loop;
  end if;

  -- Riego: agua aplicada (m³/ha o total) y sistema
  if payload ? 'riego' and jsonb_typeof(payload->'riego') = 'object'
     and (nullif(payload->'riego'->>'m3_ha','') is not null or nullif(payload->'riego'->>'volumen_m3','') is not null) then
    select coalesce(sum(superficie_trabajada_ha),0) into v_sup from partes_trabajo_recintos where parte_trabajo_id = v_id;
    insert into riegos_parte (parte_trabajo_id, sistema, m3_ha, volumen_m3, origen_agua, fertirrigacion)
    values (v_id, nullif(payload->'riego'->>'sistema',''),
            coalesce(nullif(payload->'riego'->>'m3_ha','')::numeric,
                     round(nullif(payload->'riego'->>'volumen_m3','')::numeric / nullif(v_sup,0), 2)),
            coalesce(nullif(payload->'riego'->>'volumen_m3','')::numeric,
                     round(nullif(payload->'riego'->>'m3_ha','')::numeric * nullif(v_sup,0), 2)),
            nullif(payload->'riego'->>'origen_agua',''),
            coalesce((payload->'riego'->>'fertirrigacion')::boolean, false));
  end if;

  if es_gestor(v_emp) and v_estado = 'validado' then
    update partes_trabajo set validado_por = auth.uid(), validado_en = now()
     where id = v_id and validado_por is null;
  end if;

  return v_id;
end $$;

-- 6. Exportación RGPD incluye los riegos
create or replace function exportar_datos_empresa(p_empresa uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare r jsonb := jsonb_build_object('exportado_en', now(), 'formato', 'Cultivix JSON v1'); t text; v jsonb;
begin
  if not es_admin(p_empresa) then raise exception 'Solo el titular o administrador puede exportar los datos'; end if;
  foreach t in array array['empresas','fincas','parcelas','recintos','campanas','recinto_cultivos','trabajadores',
    'maquinaria','aperos','maquinaria_documentos','averias','mantenimientos','labores','clientes','partes_trabajo',
    'proveedores','productos','albaranes_compra','stock_ajustes','aplicaciones','documentos','fotografias',
    'observaciones_agronomicas','destinos_cosecha','entregas_cosecha','liquidaciones_cosecha',
    'asesores','planes_abonado','consultas_agronomia'] loop
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
    'riegos_parte', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from riegos_parte x join partes_trabajo p on p.id = x.parte_trabajo_id where p.empresa_id = p_empresa),
    'entregas_cosecha_recintos', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from entregas_cosecha_recintos x join entregas_cosecha e on e.id = x.entrega_id where e.empresa_id = p_empresa));
  return r;
end $$;

-- 7. Cierre de cada carga semanal del Registro (solo la función de carga, con service role)
create or replace function fito_finalizar_carga(p_lote text, p_ids integer[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from fito_usos where lote <> p_lote;
  update fito_productos set estado = 'Retirado del registro'
   where not (id = any(p_ids)) and estado <> 'Retirado del registro';
  insert into fito_info values ('fecha_datos', p_lote) on conflict (clave) do update set valor = excluded.valor;
  insert into fito_info values ('actualizado_en', now()::text) on conflict (clave) do update set valor = excluded.valor;
end $$;
revoke execute on function fito_finalizar_carga(text, integer[]) from public, anon, authenticated;
do $$ begin grant execute on function fito_finalizar_carga(text, integer[]) to service_role; exception when undefined_object then null; end $$;

-- 8. Carga por partes: cada uso lleva su nº de orden en la exportación
alter table fito_usos add column if not exists orden integer;
create unique index if not exists ux_fito_usos_lote_orden on fito_usos(lote, orden);

-- 9. Actualización semanal (sábados, 07:17 UTC; el MAPA actualiza los viernes)
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'actualizar-fitos';
    perform cron.schedule('actualizar-fitos', '17 7 * * 6',
      $c$select net.http_post(url := 'https://luptzilwztijtqaacong.supabase.co/functions/v1/actualizar-fitos',
                             headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb,
                             timeout_milliseconds := 300000)$c$);
  end if;
end $$;
