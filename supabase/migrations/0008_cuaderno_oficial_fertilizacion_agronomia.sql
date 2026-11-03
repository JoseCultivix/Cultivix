-- =====================================================================
-- 0008 · Cuaderno oficial (SIEX/CUE), fertilización sostenible y AgronomIA
--  - Datos que exige el modelo oficial: ROPO/carné de aplicadores, ROMA e
--    inspección de equipos, asesores (GIP y fertilización), código REA.
--  - Fertilización (RD 1051/2022): riqueza N-P2O5-K2O de productos, método
--    de aplicación, plan de abonado por campaña o recinto y balance aplicado
--    frente al máximo por recinto.
--  - Eficacia y justificación de tratamientos (modelo oficial, apartado 3).
--  - Historial de consultas técnicas a AgronomIA.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Datos de explotación, aplicadores y equipos
-- ---------------------------------------------------------------------
alter table empresas add column if not exists codigo_rea text;

alter table trabajadores add column if not exists numero_ropo text;
alter table trabajadores add column if not exists tipo_carne text
  check (tipo_carne in ('basico','cualificado','fumigador','piloto'));

alter table maquinaria add column if not exists fecha_ultima_inspeccion date;

alter table recintos add column if not exists zona_vulnerable boolean not null default false;

-- Asesores de la explotación (GIP fitosanitarios y/o fertilización)
create table if not exists asesores (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  nombre        text not null,
  nif           text,
  numero_ropo   text,
  ambito        text not null default 'ambos' check (ambito in ('fitosanitarios','fertilizacion','ambos')),
  entidad       text,           -- agrupación / ATRIA / cooperativa / empresa
  telefono      text,
  email         text,
  usuario_id    uuid references usuarios(id) on delete set null,  -- si entra en la app como técnico
  activo        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_asesores_emp on asesores(empresa_id);

-- ---------------------------------------------------------------------
-- 2. Productos fertilizantes: riqueza y origen
-- ---------------------------------------------------------------------
alter table productos add column if not exists riqueza_n     numeric(5,2) check (riqueza_n between 0 and 100);
alter table productos add column if not exists riqueza_p2o5  numeric(5,2) check (riqueza_p2o5 between 0 and 100);
alter table productos add column if not exists riqueza_k2o   numeric(5,2) check (riqueza_k2o between 0 and 100);
alter table productos add column if not exists n_organico    boolean not null default false; -- estiércol, purín, compost…
alter table productos add column if not exists densidad_kg_l numeric(6,3) check (densidad_kg_l > 0);

-- Detecta "15-15-15", "8-4-10", "20,5-0-0" en el nombre al crear un producto
create or replace function detectar_riqueza_producto() returns trigger
language plpgsql set search_path = public as $$
declare m text[];
begin
  if new.riqueza_n is null and new.riqueza_p2o5 is null and new.riqueza_k2o is null then
    m := regexp_match(new.nombre, '(?:^|[^0-9])(\d{1,2}(?:[.,]\d{1,2})?)\s*-\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*-\s*(\d{1,2}(?:[.,]\d{1,2})?)(?:[^0-9]|$)');
    if m is not null then
      new.riqueza_n    := replace(m[1], ',', '.')::numeric;
      new.riqueza_p2o5 := replace(m[2], ',', '.')::numeric;
      new.riqueza_k2o  := replace(m[3], ',', '.')::numeric;
      if new.riqueza_n + new.riqueza_p2o5 + new.riqueza_k2o > 100 then
        new.riqueza_n := null; new.riqueza_p2o5 := null; new.riqueza_k2o := null;
      elsif new.tipo = 'otro' then
        new.tipo := 'fertilizante';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_productos_riqueza on productos;
create trigger trg_productos_riqueza before insert on productos
  for each row execute function detectar_riqueza_producto();

-- Rellena los productos ya existentes cuyo nombre trae la riqueza
update productos p set riqueza_n = x.n, riqueza_p2o5 = x.p, riqueza_k2o = x.k,
       tipo = case when p.tipo = 'otro' then 'fertilizante' else p.tipo end
from (
  select id, replace(m[1], ',', '.')::numeric n, replace(m[2], ',', '.')::numeric p, replace(m[3], ',', '.')::numeric k
  from (select id, regexp_match(nombre, '(?:^|[^0-9])(\d{1,2}(?:[.,]\d{1,2})?)\s*-\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*-\s*(\d{1,2}(?:[.,]\d{1,2})?)(?:[^0-9]|$)') m
          from productos where riqueza_n is null and riqueza_p2o5 is null and riqueza_k2o is null) s
  where m is not null
) x
where p.id = x.id and x.n + x.p + x.k <= 100;

-- ---------------------------------------------------------------------
-- 3. Aplicaciones: método, eficacia y justificación
-- ---------------------------------------------------------------------
alter table aplicaciones add column if not exists metodo_aplicacion text
  check (metodo_aplicacion in ('abonadora','fertirrigacion','foliar','localizado','enterrado','cuba','pulverizacion','espolvoreo','otro'));
alter table aplicaciones add column if not exists eficacia text check (eficacia in ('buena','regular','mala'));
alter table aplicaciones add column if not exists justificacion text; -- umbral, aviso fitosanitario, recomendación del asesor…
alter table aplicaciones add column if not exists asesor_id uuid references asesores(id) on delete set null;

-- Un producto "otro" que se usa en un abonado pasa a ser fertilizante
create or replace function marcar_fertilizante() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update productos set tipo = 'fertilizante'
   where id = new.producto_id and tipo = 'otro'
     and exists (select 1 from aplicaciones a where a.id = new.aplicacion_id and a.tipo = 'fertilizacion');
  return new;
end $$;
revoke execute on function marcar_fertilizante() from public, anon, authenticated;
drop trigger if exists trg_aplp_fertilizante on aplicaciones_productos;
create trigger trg_aplp_fertilizante after insert on aplicaciones_productos
  for each row execute function marcar_fertilizante();
update productos pr set tipo = 'fertilizante'
 where pr.tipo = 'otro' and exists (select 1 from aplicaciones_productos ap join aplicaciones a on a.id = ap.aplicacion_id
                                    where ap.producto_id = pr.id and a.tipo = 'fertilizacion');

-- ---------------------------------------------------------------------
-- 4. Plan de abonado (RD 1051/2022, art. 5.a y 6)
--    Por campaña (todo el cultivo) o por recinto (sustituye al general).
-- ---------------------------------------------------------------------
create table if not exists planes_abonado (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null references empresas(id) on delete cascade,
  campana_id           uuid not null references campanas(id) on delete cascade,
  recinto_id           uuid references recintos(id) on delete cascade,
  rendimiento_esperado_kg_ha numeric(12,2),
  cultivo_precedente   text,
  n_kg_ha              numeric(8,2) check (n_kg_ha >= 0),     -- máximo / necesidad de N
  p2o5_kg_ha           numeric(8,2) check (p2o5_kg_ha >= 0),
  k2o_kg_ha            numeric(8,2) check (k2o_kg_ha >= 0),
  origen               text not null default 'plan_abonado'
                       check (origen in ('plan_abonado','recomendacion_asesor','programa_zona_vulnerable','estimacion')),
  fecha_elaboracion    date not null default current_date,
  asesor_id            uuid references asesores(id) on delete set null,
  notas                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists ux_plan_campana on planes_abonado(campana_id) where recinto_id is null;
create unique index if not exists ux_plan_recinto on planes_abonado(campana_id, recinto_id) where recinto_id is not null;
drop trigger if exists trg_planes_abonado_upd on planes_abonado;
create trigger trg_planes_abonado_upd before update on planes_abonado
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 5. Consultas a AgronomIA (historial)
-- ---------------------------------------------------------------------
create table if not exists consultas_agronomia (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  usuario_id  uuid not null default auth.uid() references usuarios(id) on delete cascade,
  recinto_id  uuid references recintos(id) on delete set null,
  pregunta    text not null,
  respuesta   text not null,
  con_foto    boolean not null default false,
  valoracion  smallint check (valoracion in (-1, 1)),
  created_at  timestamptz not null default now()
);
create index if not exists idx_consultas_agro on consultas_agronomia(empresa_id, created_at desc);

-- ---------------------------------------------------------------------
-- 6. Seguridad (RLS)
-- ---------------------------------------------------------------------
create or replace function es_gestor_o_tecnico(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(rol_en(e) in ('propietario','administrador','encargado','tecnico'), false)
$$;
revoke execute on function es_gestor_o_tecnico(uuid) from public, anon;
grant execute on function es_gestor_o_tecnico(uuid) to authenticated;

alter table asesores enable row level security;
alter table planes_abonado enable row level security;
alter table consultas_agronomia enable row level security;

drop policy if exists ase_sel on asesores;
drop policy if exists ase_wr on asesores;
create policy ase_sel on asesores for select using (es_miembro(empresa_id));
create policy ase_wr  on asesores for all using (es_gestor(empresa_id)) with check (es_gestor(empresa_id));

drop policy if exists plan_sel on planes_abonado;
drop policy if exists plan_wr on planes_abonado;
create policy plan_sel on planes_abonado for select using (es_miembro(empresa_id));
create policy plan_wr  on planes_abonado for all using (es_gestor_o_tecnico(empresa_id)) with check (es_gestor_o_tecnico(empresa_id));

drop policy if exists cagro_sel on consultas_agronomia;
drop policy if exists cagro_ins on consultas_agronomia;
drop policy if exists cagro_upd on consultas_agronomia;
drop policy if exists cagro_del on consultas_agronomia;
create policy cagro_sel on consultas_agronomia for select
  using (usuario_id = auth.uid() or es_gestor_o_tecnico(empresa_id));
create policy cagro_ins on consultas_agronomia for insert
  with check (usuario_id = auth.uid() and es_miembro(empresa_id));
create policy cagro_upd on consultas_agronomia for update
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
create policy cagro_del on consultas_agronomia for delete using (usuario_id = auth.uid());

-- ---------------------------------------------------------------------
-- 7. Cuaderno de campo con los campos del modelo oficial
-- ---------------------------------------------------------------------
create or replace view v_cuaderno_campo with (security_invoker = true) as
select p.empresa_id, p.id as parte_trabajo_id, p.fecha, ptr.campana_id,
  r.id as recinto_id, r.referencia_sigpac, pa.nombre as parcela, r.superficie_sigpac_ha,
  ptr.superficie_trabajada_ha,
  (select cu.nombre from cultivos cu where cu.id = cultivo_de_recinto(r.id, p.fecha)) as cultivo,
  a.tipo as tipo_aplicacion, a.plaga_o_motivo,
  pr.nombre as producto, pr.numero_registro, pr.materia_activa,
  ap.dosis_ha, ap.unidad_dosis,
  coalesce(round(ap.dosis_ha * ptr.superficie_trabajada_ha, 3), ap.cantidad_total) as cantidad_recinto,
  ap.cantidad_total as cantidad_total_parte,
  l.nombre as labor,
  (select string_agg(m.nombre, ', ') from partes_trabajo_maquinaria x join maquinaria m on m.id = x.maquinaria_id
     where x.parte_trabajo_id = p.id) as maquinaria,
  (select string_agg(t.nombre || coalesce(' '||t.apellidos,''), ', ') from partes_trabajo_trabajadores x
     join trabajadores t on t.id = x.trabajador_id where x.parte_trabajo_id = p.id) as aplicador,
  p.estado,
  -- columnas nuevas (0008)
  a.id as aplicacion_id, pr.id as producto_id, pr.tipo as tipo_producto, pr.unidad as unidad_producto,
  pr.riqueza_n, pr.riqueza_p2o5, pr.riqueza_k2o, pr.n_organico,
  a.metodo_aplicacion, a.eficacia, a.justificacion, a.volumen_caldo_l_ha,
  (select string_agg(coalesce(m.numero_roma, '—'), ', ') from partes_trabajo_maquinaria x join maquinaria m on m.id = x.maquinaria_id
     where x.parte_trabajo_id = p.id) as numero_roma,
  (select string_agg(coalesce(t.numero_ropo, '—'), ', ') from partes_trabajo_trabajadores x
     join trabajadores t on t.id = x.trabajador_id where x.parte_trabajo_id = p.id) as numero_ropo,
  pr.plazo_seguridad_dias,
  ase.nombre as asesor, ase.numero_ropo as asesor_ropo
from partes_trabajo p
join aplicaciones a on a.parte_trabajo_id = p.id
join aplicaciones_productos ap on ap.aplicacion_id = a.id
join productos pr on pr.id = ap.producto_id
join partes_trabajo_recintos ptr on ptr.parte_trabajo_id = p.id
join recintos r on r.id = ptr.recinto_id
join parcelas pa on pa.id = r.parcela_id
left join labores l on l.id = p.labor_id
left join asesores ase on ase.id = a.asesor_id
where p.estado in ('validado','pendiente');

-- ---------------------------------------------------------------------
-- 8. Aportes de nutrientes por recinto y balance frente al plan
-- ---------------------------------------------------------------------
create or replace view v_aportes_nutrientes with (security_invoker = true) as
with base as (
  select p.empresa_id, p.id as parte_trabajo_id, p.fecha, ptr.campana_id, ptr.recinto_id,
    pr.id as producto_id, pr.nombre as producto, pr.unidad, pr.riqueza_n, pr.riqueza_p2o5, pr.riqueza_k2o, pr.n_organico,
    a.metodo_aplicacion,
    -- kg (o l) de producto por hectárea en este recinto
    coalesce(ap.dosis_ha,
             ap.cantidad_total / nullif(sum(coalesce(ptr.superficie_trabajada_ha, r.superficie_sigpac_ha, 0))
                                          over (partition by ap.id), 0)) as dosis_ud_ha,
    case pr.unidad when 'kg' then 1 when 't' then 1000 when 'g' then 0.001
                   when 'l' then coalesce(pr.densidad_kg_l, 1) when 'ml' then coalesce(pr.densidad_kg_l, 1) / 1000
                   else null end as factor_kg
  from partes_trabajo p
  join aplicaciones a on a.parte_trabajo_id = p.id
  join aplicaciones_productos ap on ap.aplicacion_id = a.id
  join productos pr on pr.id = ap.producto_id
  join partes_trabajo_recintos ptr on ptr.parte_trabajo_id = p.id
  join recintos r on r.id = ptr.recinto_id
  where p.estado in ('validado','pendiente')
    and (a.tipo = 'fertilizacion' or pr.tipo = 'fertilizante' or pr.riqueza_n is not null or pr.riqueza_p2o5 is not null or pr.riqueza_k2o is not null)
)
select *, round(dosis_ud_ha * factor_kg, 3) as dosis_kg_ha,
  round(dosis_ud_ha * factor_kg * coalesce(riqueza_n,0)    / 100, 2) as n_kg_ha,
  round(dosis_ud_ha * factor_kg * coalesce(riqueza_p2o5,0) / 100, 2) as p2o5_kg_ha,
  round(dosis_ud_ha * factor_kg * coalesce(riqueza_k2o,0)  / 100, 2) as k2o_kg_ha,
  (riqueza_n is null and riqueza_p2o5 is null and riqueza_k2o is null) as sin_riqueza
from base;

create or replace view v_fertilizacion_recintos with (security_invoker = true) as
select rc.empresa_id, rc.campana_id, c.nombre as campana, rc.recinto_id, r.parcela_id, pa.nombre as parcela,
  r.referencia_sigpac, coalesce(rc.superficie_ha, r.superficie_sigpac_ha) as superficie_ha,
  cu.nombre as cultivo, rc.regadio, r.zona_vulnerable,
  coalesce(ag.n, 0) as n_aplicado_kg_ha, coalesce(ag.p, 0) as p2o5_aplicado_kg_ha, coalesce(ag.k, 0) as k2o_aplicado_kg_ha,
  coalesce(ag.n_org, 0) as n_organico_kg_ha, coalesce(ag.aplicaciones, 0) as aplicaciones,
  coalesce(ag.sin_riqueza, 0) as productos_sin_riqueza,
  coalesce(pr_.n_kg_ha, pc.n_kg_ha) as n_max_kg_ha,
  coalesce(pr_.p2o5_kg_ha, pc.p2o5_kg_ha) as p2o5_max_kg_ha,
  coalesce(pr_.k2o_kg_ha, pc.k2o_kg_ha) as k2o_max_kg_ha,
  coalesce(pr_.origen, pc.origen) as origen_maximo,
  case when pr_.id is not null then 'recinto' when pc.id is not null then 'campana' end as nivel_plan,
  coalesce(pr_.id, pc.id) as plan_id
from recinto_cultivos rc
join campanas c on c.id = rc.campana_id
join recintos r on r.id = rc.recinto_id
join parcelas pa on pa.id = r.parcela_id
join cultivos cu on cu.id = rc.cultivo_id
left join lateral (
  select sum(n_kg_ha) n, sum(p2o5_kg_ha) p, sum(k2o_kg_ha) k,
         sum(case when n_organico then n_kg_ha else 0 end) n_org,
         count(distinct parte_trabajo_id) aplicaciones,
         count(distinct producto_id) filter (where sin_riqueza) sin_riqueza
  from v_aportes_nutrientes v where v.recinto_id = rc.recinto_id and v.campana_id = rc.campana_id
) ag on true
left join planes_abonado pc on pc.campana_id = rc.campana_id and pc.recinto_id is null
left join planes_abonado pr_ on pr_.campana_id = rc.campana_id and pr_.recinto_id = rc.recinto_id
where rc.activo and r.activo;

-- Cosecha comercializada por recinto para el apartado del cuaderno oficial
create or replace view v_cuaderno_cosecha with (security_invoker = true) as
select e.empresa_id, e.id as entrega_id, e.fecha, e.campana_id, cu.nombre as cultivo,
  r.referencia_sigpac, pa.nombre as parcela, er.kilos, e.kilos_netos, e.numero_ticket,
  d.nombre as destino, d.nif as destino_nif, e.calidad
from entregas_cosecha e
left join cultivos cu on cu.id = e.cultivo_id
left join destinos_cosecha d on d.id = e.destino_id
left join v_entregas_recintos er on er.entrega_id = e.id
left join recintos r on r.id = er.recinto_id
left join parcelas pa on pa.id = r.parcela_id;

-- 9. guardar_parte acepta método, eficacia y justificación
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

  if es_gestor(v_emp) and v_estado = 'validado' then
    update partes_trabajo set validado_por = auth.uid(), validado_en = now()
     where id = v_id and validado_por is null;
  end if;

  return v_id;
end $$;

-- 10. Exportación RGPD incluye las tablas nuevas
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
    'entregas_cosecha_recintos', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from entregas_cosecha_recintos x join entregas_cosecha e on e.id = x.entrega_id where e.empresa_id = p_empresa));
  return r;
end $$;


-- 11. Las consultas a AgronomIA cuentan en el límite diario de IA y en el panel de la beta
create or replace function ia_usos_hoy() returns int
language sql stable security definer set search_path = public as $$
  select ((select count(*) from acciones_ia where usuario_id = auth.uid() and created_at > now() - interval '24 hours')
        + (select count(*) from consultas_agronomia where usuario_id = auth.uid() and created_at > now() - interval '24 hours'))::int
$$;

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
    (select count(*) from acciones_ia x where x.empresa_id = e.id) + (select count(*) from consultas_agronomia x where x.empresa_id = e.id),
    (select count(*) from sugerencias x where x.empresa_id = e.id)
  from empresas e
  order by 5 desc nulls last;
end $$;
