-- =====================================================================
-- CULTIVIX · 0006 · CAMPAÑAS POR CULTIVO + MÓDULO DE COSECHAS
-- ---------------------------------------------------------------------
-- 1) Cada cultivo tiene su propia campaña con fechas editables
--    (olivar 1 oct – 30 sep, pistacho año natural…). Un parte que afecte a
--    recintos de cultivos distintos queda asignado, recinto a recinto,
--    a la campaña de cada cultivo.
-- 2) Cosechas: destinos (almazara, cooperativa, comprador), entregas o
--    tickets con kilos, calidad, rendimiento…, y liquidaciones que ponen
--    precio a las entregas. Los ingresos alimentan la rentabilidad.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CAMPAÑAS POR CULTIVO
-- ---------------------------------------------------------------------
alter table campanas add column if not exists cultivo_id uuid references cultivos(id) on delete cascade;
drop index if exists ux_campana_activa;
create unique index ux_campana_activa on campanas
  (empresa_id, coalesce(cultivo_id, '00000000-0000-0000-0000-000000000000'::uuid)) where activa;
create index if not exists idx_campanas_cultivo on campanas(empresa_id, cultivo_id, fecha_inicio);

-- Fechas por defecto de la campaña de un cultivo que contiene una fecha
create or replace function campana_fechas_defecto(p_cultivo uuid, p_fecha date,
  out fecha_inicio date, out fecha_fin date, out nombre text)
language plpgsql stable set search_path = public as $$
declare v_nom text; v_y int := extract(year from p_fecha)::int;
begin
  select c.nombre into v_nom from cultivos c where c.id = p_cultivo;
  if v_nom ilike 'olivar%' then
    -- Campaña oleícola: 1 oct – 30 sep
    if extract(month from p_fecha) < 10 then v_y := v_y - 1; end if;
    fecha_inicio := make_date(v_y, 10, 1);
    fecha_fin := make_date(v_y + 1, 9, 30);
    nombre := coalesce(v_nom, 'Campaña') || ' ' || v_y || '/' || right((v_y + 1)::text, 2);
  else
    fecha_inicio := make_date(v_y, 1, 1);
    fecha_fin := make_date(v_y, 12, 31);
    nombre := coalesce(v_nom, 'Campaña') || ' ' || v_y;
  end if;
end $$;

-- Campaña aplicable a (empresa, cultivo, fecha): la del cultivo y, si no hay, la general
create or replace function campana_de(p_empresa uuid, p_cultivo uuid, p_fecha date) returns uuid
language sql stable security definer set search_path = public as $$
  select id from (
    select id, 0 as prio, activa from campanas
     where empresa_id = p_empresa and cultivo_id = p_cultivo and p_cultivo is not null
       and p_fecha between fecha_inicio and fecha_fin
    union all
    select id, 1, activa from campanas
     where empresa_id = p_empresa and cultivo_id is null
       and p_fecha between fecha_inicio and fecha_fin
  ) x order by prio, activa desc limit 1
$$;

-- Cultivo de un recinto en una fecha (según la campaña que cubre esa fecha)
create or replace function cultivo_de_recinto(p_recinto uuid, p_fecha date) returns uuid
language sql stable security definer set search_path = public as $$
  select rc.cultivo_id
    from recinto_cultivos rc
    left join campanas c on c.id = rc.campana_id
   where rc.recinto_id = p_recinto and rc.activo
   order by (p_fecha between c.fecha_inicio and c.fecha_fin) desc nulls last, c.fecha_inicio desc nulls last
   limit 1
$$;

-- Crea (si no existe) la campaña de un cultivo que contiene la fecha. Devuelve su id.
create or replace function asegurar_campana(p_empresa uuid, p_cultivo uuid, p_fecha date default current_date)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; f record; v_activa boolean;
begin
  if not es_gestor(p_empresa) and auth.uid() is not null then
    raise exception 'Sin permiso para crear campañas';
  end if;
  select id into v_id from campanas
   where empresa_id = p_empresa and cultivo_id = p_cultivo and p_fecha between fecha_inicio and fecha_fin
   order by activa desc limit 1;
  if v_id is not null then return v_id; end if;
  select * into f from campana_fechas_defecto(p_cultivo, p_fecha);
  v_activa := current_date between f.fecha_inicio and f.fecha_fin;
  if v_activa then
    update campanas set activa = false where empresa_id = p_empresa and cultivo_id = p_cultivo and activa;
  end if;
  insert into campanas (empresa_id, cultivo_id, nombre, fecha_inicio, fecha_fin, activa)
  values (p_empresa, p_cultivo, f.nombre, f.fecha_inicio, f.fecha_fin, v_activa)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function asegurar_campana(uuid, uuid, date) to authenticated;
revoke execute on function asegurar_campana(uuid, uuid, date) from public, anon;

-- El parte solo toma por defecto una campaña general; la de cultivo la pone cada recinto
create or replace function partes_before_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.inicio is not null and new.fin is not null and new.fin > new.inicio then
    new.horas_totales := round(extract(epoch from (new.fin - new.inicio)) / 3600.0, 2);
  end if;
  if new.campana_id is null or (tg_op = 'UPDATE' and new.fecha is distinct from old.fecha) then
    new.campana_id := coalesce(
      (select ptr.campana_id from partes_trabajo_recintos ptr where ptr.parte_trabajo_id = new.id and ptr.campana_id is not null limit 1),
      campana_de(new.empresa_id, null, new.fecha));
  end if;
  return new;
end $$;

alter table partes_trabajo_recintos add column if not exists campana_id uuid references campanas(id) on delete set null;
create index if not exists idx_ptr_campana on partes_trabajo_recintos(campana_id);

create or replace function ptr_asignar_campana() returns trigger
language plpgsql set search_path = public as $$
declare v_emp uuid; v_fecha date;
begin
  select empresa_id, fecha into v_emp, v_fecha from partes_trabajo where id = new.parte_trabajo_id;
  new.campana_id := campana_de(v_emp, cultivo_de_recinto(new.recinto_id, v_fecha), v_fecha);
  return new;
end $$;
drop trigger if exists trg_ptr_campana on partes_trabajo_recintos;
create trigger trg_ptr_campana before insert on partes_trabajo_recintos
  for each row execute function ptr_asignar_campana();

create or replace function ptr_campana_a_parte() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.campana_id is not null then
    update partes_trabajo p set campana_id = new.campana_id
     where p.id = new.parte_trabajo_id
       and (p.campana_id is null or exists (select 1 from campanas c where c.id = p.campana_id and c.cultivo_id is null));
  end if;
  return null;
end $$;
drop trigger if exists trg_ptr_campana_parte on partes_trabajo_recintos;
create trigger trg_ptr_campana_parte after insert on partes_trabajo_recintos
  for each row execute function ptr_campana_a_parte();

-- ---- Migración de datos: campaña general → campañas por cultivo ----
do $$
declare r record; v_camp uuid;
begin
  for r in
    select distinct rc.empresa_id, rc.cultivo_id
      from recinto_cultivos rc join campanas c on c.id = rc.campana_id
     where c.cultivo_id is null
  loop
    v_camp := asegurar_campana(r.empresa_id, r.cultivo_id, current_date);
    update recinto_cultivos rc set campana_id = v_camp
      from campanas c
     where c.id = rc.campana_id and c.cultivo_id is null
       and rc.empresa_id = r.empresa_id and rc.cultivo_id = r.cultivo_id;
  end loop;
  -- Recalcular campañas de partes existentes
  update partes_trabajo_recintos ptr
     set campana_id = campana_de(p.empresa_id, cultivo_de_recinto(ptr.recinto_id, p.fecha), p.fecha)
    from partes_trabajo p where p.id = ptr.parte_trabajo_id;
  update partes_trabajo p set campana_id = x.campana_id
    from (select distinct on (parte_trabajo_id) parte_trabajo_id, campana_id
            from partes_trabajo_recintos where campana_id is not null) x
   where x.parte_trabajo_id = p.id;
  -- Las campañas generales sin uso se eliminan
  delete from campanas c where c.cultivo_id is null
     and not exists (select 1 from partes_trabajo p where p.campana_id = c.id)
     and not exists (select 1 from recinto_cultivos rc where rc.campana_id = c.id);
end $$;

-- Alta de empresa: una campaña por cultivo elegido
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
  v_m text;
  v_cult uuid;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'El nombre es obligatorio'; end if;

  insert into usuarios (id, email) select v_uid, email from auth.users where id = v_uid
  on conflict (id) do nothing;

  insert into empresas (nombre, provincia, municipio) values (trim(p_nombre), p_provincia, p_municipio)
  returning id into v_emp;
  insert into empresa_usuarios (empresa_id, usuario_id, rol) values (v_emp, v_uid, 'propietario');
  update usuarios set empresa_activa_id = v_emp where id = v_uid;

  insert into modulos_empresa (empresa_id, modulo)
  select v_emp, m from unnest(array['territorio','operaciones','maquinaria','productos','cuaderno','compras','cosechas','ia']) m;

  select coalesce(nombre, split_part(email,'@',1)) into v_nombre from usuarios where id = v_uid;
  insert into trabajadores (empresa_id, usuario_id, nombre, tipo_trabajador, coste_hora)
  values (v_emp, v_uid, coalesce(v_nombre,'Titular'), 'propietario', 0);

  -- Cultivos propios si no están en el catálogo global, y su campaña
  foreach v_m in array p_cultivos loop
    select id into v_cult from cultivos where empresa_id is null and lower(nombre) = lower(v_m);
    if v_cult is null then
      insert into cultivos (empresa_id, nombre) values (v_emp, v_m) returning id into v_cult;
    end if;
    perform asegurar_campana(v_emp, v_cult, current_date);
  end loop;

  foreach v_m in array p_maquinaria loop
    insert into maquinaria (empresa_id, nombre, tipo) values (v_emp, v_m, lower(split_part(v_m,' ',1)));
  end loop;
  foreach v_m in array p_aperos loop
    insert into aperos (empresa_id, nombre, tipo) values (v_emp, v_m, lower(split_part(v_m,' ',1)));
  end loop;

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
  update labores l set maquinaria_habitual_id = m.id
    from maquinaria m
   where m.empresa_id = v_emp and l.empresa_id = v_emp and l.apero_habitual_id is null and (
         (l.nombre = 'Tratamiento fitosanitario' and m.nombre ilike '%atomizador%') or
         (l.nombre = 'Recolección' and m.nombre ilike '%vibrador%'));
  return v_emp;
end $$;

-- Cuaderno de campo: el cultivo y la campaña se toman del recinto
drop view if exists v_cuaderno_campo;
create view v_cuaderno_campo with (security_invoker = true) as
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
  p.estado
from partes_trabajo p
join aplicaciones a on a.parte_trabajo_id = p.id
join aplicaciones_productos ap on ap.aplicacion_id = a.id
join productos pr on pr.id = ap.producto_id
join partes_trabajo_recintos ptr on ptr.parte_trabajo_id = p.id
join recintos r on r.id = ptr.recinto_id
join parcelas pa on pa.id = r.parcela_id
left join labores l on l.id = p.labor_id
where p.estado in ('validado','pendiente');

-- ---------------------------------------------------------------------
-- 2. COSECHAS
-- ---------------------------------------------------------------------
create table destinos_cosecha (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  tipo        text not null default 'almazara'
              check (tipo in ('almazara','cooperativa','comprador','industria','otro')),
  nif         text,
  telefono    text,
  email       text,
  direccion   text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index ux_destino_nombre on destinos_cosecha(empresa_id, lower(nombre));

-- Liquidación: documento del destino que pone precio a una o varias entregas
create table liquidaciones_cosecha (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  destino_id    uuid references destinos_cosecha(id) on delete set null,
  cultivo_id    uuid references cultivos(id) on delete set null,
  campana_id    uuid references campanas(id) on delete set null,
  fecha         date not null default current_date,
  numero        text,
  tipo          text not null default 'definitiva' check (tipo in ('anticipo','parcial','definitiva')),
  importe_bruto numeric(14,2),
  retenciones   numeric(14,2),     -- retención IRPF, cuotas de cooperativa…
  iva           numeric(14,2),
  importe_neto  numeric(14,2),
  documento_id  uuid references documentos(id) on delete set null,
  cobrada       boolean not null default false,
  observaciones text,
  created_at    timestamptz not null default now()
);

-- Entrega / ticket de cosecha
create table entregas_cosecha (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  destino_id     uuid references destinos_cosecha(id) on delete set null,
  cultivo_id     uuid not null references cultivos(id) on delete restrict,
  campana_id     uuid references campanas(id) on delete set null,
  fecha          date not null default current_date,
  numero_ticket  text,
  calidad        text,                 -- vuelo, suelo, extra, calibre…
  variedad       text,
  kilos_brutos   numeric(12,2),
  kilos_netos    numeric(12,2) not null,
  rendimiento_pct numeric(6,2),        -- rendimiento graso (olivar)
  humedad_pct    numeric(6,2),
  impurezas_pct  numeric(6,2),
  acidez         numeric(6,2),
  -- Precio: se fija al liquidar (o a mano). Por kg de fruto o por kg de aceite.
  precio         numeric(12,4),
  precio_unidad  text not null default 'kg' check (precio_unidad in ('kg','kg_aceite')),
  importe        numeric(14,2) generated always as (
                   case when precio is null then null
                        when precio_unidad = 'kg_aceite' then round(kilos_netos * coalesce(rendimiento_pct,0) / 100 * precio, 2)
                        else round(kilos_netos * precio, 2) end) stored,
  kilos_aceite   numeric(12,2) generated always as (
                   case when rendimiento_pct is null then null else round(kilos_netos * rendimiento_pct / 100, 2) end) stored,
  liquidacion_id uuid references liquidaciones_cosecha(id) on delete set null,
  documento_id   uuid references documentos(id) on delete set null,
  parte_trabajo_id uuid references partes_trabajo(id) on delete set null,
  observaciones  text,
  creado_por     uuid references usuarios(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_entregas_empresa on entregas_cosecha(empresa_id, fecha desc);
create index idx_entregas_campana on entregas_cosecha(campana_id);
create trigger trg_entregas_upd before update on entregas_cosecha
  for each row execute function set_updated_at();

create or replace function entregas_before_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.campana_id is null or (tg_op = 'UPDATE' and (new.fecha is distinct from old.fecha or new.cultivo_id is distinct from old.cultivo_id)) then
    new.campana_id := campana_de(new.empresa_id, new.cultivo_id, new.fecha);
  end if;
  return new;
end $$;
create trigger trg_entregas_bw before insert or update on entregas_cosecha
  for each row execute function entregas_before_write();

-- Recintos de los que procede la entrega (opcionalmente con kilos)
create table entregas_cosecha_recintos (
  id          uuid primary key default gen_random_uuid(),
  entrega_id  uuid not null references entregas_cosecha(id) on delete cascade,
  recinto_id  uuid not null references recintos(id) on delete restrict,
  kilos       numeric(12,2),
  unique (entrega_id, recinto_id)
);

alter table destinos_cosecha enable row level security;
alter table liquidaciones_cosecha enable row level security;
alter table entregas_cosecha enable row level security;
alter table entregas_cosecha_recintos enable row level security;

create policy dest_sel on destinos_cosecha for select using (es_miembro(empresa_id));
create policy dest_ins on destinos_cosecha for insert with check (es_miembro(empresa_id));
create policy dest_upd on destinos_cosecha for update using (es_gestor(empresa_id)) with check (es_gestor(empresa_id));
create policy dest_del on destinos_cosecha for delete using (es_gestor(empresa_id));

create policy liq_all on liquidaciones_cosecha for all using (es_gestor(empresa_id)) with check (es_gestor(empresa_id));

-- Cualquier miembro puede apuntar una entrega (el trabajador que lleva la aceituna);
-- los gestores ven y gestionan todas; el resto solo las suyas
create policy ent_sel on entregas_cosecha for select
  using (es_gestor(empresa_id) or rol_en(empresa_id) = 'tecnico' or (es_miembro(empresa_id) and creado_por = auth.uid()));
create policy ent_ins on entregas_cosecha for insert
  with check (es_miembro(empresa_id) and rol_en(empresa_id) <> 'tecnico'
              and (es_gestor(empresa_id) or (precio is null and liquidacion_id is null)));
create policy ent_upd on entregas_cosecha for update
  using (es_gestor(empresa_id) or (creado_por = auth.uid() and liquidacion_id is null))
  with check (es_gestor(empresa_id) or (precio is null and liquidacion_id is null));
create policy ent_del on entregas_cosecha for delete
  using (es_gestor(empresa_id) or (creado_por = auth.uid() and liquidacion_id is null));

create policy entr_sel on entregas_cosecha_recintos for select
  using (exists (select 1 from entregas_cosecha e where e.id = entrega_id));
create policy entr_wr on entregas_cosecha_recintos for all
  using (exists (select 1 from entregas_cosecha e where e.id = entrega_id
                  and (es_gestor(e.empresa_id) or (e.creado_por = auth.uid() and e.liquidacion_id is null))))
  with check (exists (select 1 from entregas_cosecha e where e.id = entrega_id
                  and (es_gestor(e.empresa_id) or (e.creado_por = auth.uid() and e.liquidacion_id is null))));

-- RPC: guardar entrega completa (crea el destino si es nuevo)
-- payload = { empresa_id, id?, destino_id? | destino_nombre?, destino_tipo?, cultivo_id, fecha, numero_ticket,
--             calidad, variedad, kilos_brutos, kilos_netos, rendimiento_pct, humedad_pct, impurezas_pct, acidez,
--             precio?, precio_unidad?, documento_id?, observaciones, recinto_ids: [] }
create or replace function guardar_entrega(payload jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_emp uuid := (payload->>'empresa_id')::uuid;
  v_id  uuid := nullif(payload->>'id','')::uuid;
  v_dest uuid := nullif(payload->>'destino_id','')::uuid;
  n numeric;
begin
  if not es_miembro(v_emp) then raise exception 'Sin acceso a esta empresa'; end if;
  if v_dest is null and coalesce(trim(payload->>'destino_nombre'),'') <> '' then
    select id into v_dest from destinos_cosecha where empresa_id = v_emp and lower(nombre) = lower(trim(payload->>'destino_nombre'));
    if v_dest is null then
      insert into destinos_cosecha (empresa_id, nombre, tipo)
      values (v_emp, trim(payload->>'destino_nombre'), coalesce(nullif(payload->>'destino_tipo',''),'almazara'))
      returning id into v_dest;
    end if;
  end if;

  if v_id is null then
    insert into entregas_cosecha (empresa_id, destino_id, cultivo_id, fecha, numero_ticket, calidad, variedad,
      kilos_brutos, kilos_netos, rendimiento_pct, humedad_pct, impurezas_pct, acidez, precio, precio_unidad,
      documento_id, observaciones)
    values (v_emp, v_dest, (payload->>'cultivo_id')::uuid,
      coalesce(nullif(payload->>'fecha','')::date, current_date), payload->>'numero_ticket',
      nullif(trim(payload->>'calidad'),''), nullif(trim(payload->>'variedad'),''),
      nullif(payload->>'kilos_brutos','')::numeric, (payload->>'kilos_netos')::numeric,
      nullif(payload->>'rendimiento_pct','')::numeric, nullif(payload->>'humedad_pct','')::numeric,
      nullif(payload->>'impurezas_pct','')::numeric, nullif(payload->>'acidez','')::numeric,
      case when es_gestor(v_emp) then nullif(payload->>'precio','')::numeric end,
      coalesce(nullif(payload->>'precio_unidad',''),'kg'),
      nullif(payload->>'documento_id','')::uuid, payload->>'observaciones')
    returning id into v_id;
  else
    update entregas_cosecha set
      destino_id = v_dest, cultivo_id = (payload->>'cultivo_id')::uuid,
      fecha = coalesce(nullif(payload->>'fecha','')::date, fecha),
      numero_ticket = payload->>'numero_ticket',
      calidad = nullif(trim(payload->>'calidad'),''), variedad = nullif(trim(payload->>'variedad'),''),
      kilos_brutos = nullif(payload->>'kilos_brutos','')::numeric, kilos_netos = (payload->>'kilos_netos')::numeric,
      rendimiento_pct = nullif(payload->>'rendimiento_pct','')::numeric, humedad_pct = nullif(payload->>'humedad_pct','')::numeric,
      impurezas_pct = nullif(payload->>'impurezas_pct','')::numeric, acidez = nullif(payload->>'acidez','')::numeric,
      precio = case when es_gestor(v_emp) then nullif(payload->>'precio','')::numeric else precio end,
      precio_unidad = coalesce(nullif(payload->>'precio_unidad',''), precio_unidad),
      documento_id = coalesce(nullif(payload->>'documento_id','')::uuid, documento_id),
      observaciones = payload->>'observaciones'
    where id = v_id;
    if not found then raise exception 'Entrega no encontrada o sin permiso'; end if;
    delete from entregas_cosecha_recintos where entrega_id = v_id;
  end if;

  insert into entregas_cosecha_recintos (entrega_id, recinto_id)
  select v_id, r.id from recintos r
   where r.empresa_id = v_emp
     and r.id in (select (jsonb_array_elements_text(coalesce(payload->'recinto_ids','[]'::jsonb)))::uuid);
  return v_id;
end $$;

-- RPC: liquidar — asigna precio a un conjunto de entregas (por calidad) y crea la liquidación
-- payload = { empresa_id, destino_id, cultivo_id?, fecha, numero, tipo, retenciones?, iva?, documento_id?,
--             observaciones?, precio_unidad: 'kg'|'kg_aceite',
--             precios: [{calidad: 'Vuelo'|null, precio: 0.85}], entrega_ids: [] }
create or replace function liquidar_entregas(payload jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_emp uuid := (payload->>'empresa_id')::uuid;
  v_liq uuid;
  v_ids uuid[];
  p jsonb;
  v_bruto numeric;
  v_def numeric;
begin
  if not es_gestor(v_emp) then raise exception 'Solo el titular o encargado puede liquidar'; end if;
  select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(coalesce(payload->'entrega_ids','[]'::jsonb)) x;
  if v_ids is null then raise exception 'Selecciona al menos una entrega'; end if;

  insert into liquidaciones_cosecha (empresa_id, destino_id, cultivo_id, campana_id, fecha, numero, tipo,
                                     retenciones, iva, documento_id, observaciones)
  values (v_emp, nullif(payload->>'destino_id','')::uuid, nullif(payload->>'cultivo_id','')::uuid,
          (select campana_id from entregas_cosecha where id = v_ids[1]),
          coalesce(nullif(payload->>'fecha','')::date, current_date), payload->>'numero',
          coalesce(nullif(payload->>'tipo',''),'definitiva'),
          nullif(payload->>'retenciones','')::numeric, nullif(payload->>'iva','')::numeric,
          nullif(payload->>'documento_id','')::uuid, payload->>'observaciones')
  returning id into v_liq;

  -- Precio general (calidad nula) como respaldo
  select (e->>'precio')::numeric into v_def from jsonb_array_elements(coalesce(payload->'precios','[]'::jsonb)) e
   where coalesce(e->>'calidad','') = '' limit 1;

  for p in select * from jsonb_array_elements(coalesce(payload->'precios','[]'::jsonb)) loop
    if coalesce(p->>'calidad','') <> '' then
      update entregas_cosecha set precio = (p->>'precio')::numeric, precio_unidad = coalesce(payload->>'precio_unidad','kg'), liquidacion_id = v_liq
       where id = any(v_ids) and empresa_id = v_emp and lower(coalesce(calidad,'')) = lower(p->>'calidad');
    end if;
  end loop;
  if v_def is not null then
    update entregas_cosecha set precio = v_def, precio_unidad = coalesce(payload->>'precio_unidad','kg'), liquidacion_id = v_liq
     where id = any(v_ids) and empresa_id = v_emp and liquidacion_id is distinct from v_liq;
  end if;

  select sum(importe) into v_bruto from entregas_cosecha where liquidacion_id = v_liq;
  update liquidaciones_cosecha set
    importe_bruto = v_bruto,
    importe_neto = coalesce(nullif(payload->>'importe_neto','')::numeric,
                            v_bruto - coalesce(nullif(payload->>'retenciones','')::numeric,0) + coalesce(nullif(payload->>'iva','')::numeric,0))
   where id = v_liq;
  return v_liq;
end $$;

grant execute on function guardar_entrega(jsonb), liquidar_entregas(jsonb) to authenticated;
revoke execute on function guardar_entrega(jsonb), liquidar_entregas(jsonb) from public, anon;
revoke execute on function campana_de(uuid,uuid,date), cultivo_de_recinto(uuid,date) from public, anon;
grant execute on function campana_de(uuid,uuid,date), cultivo_de_recinto(uuid,date) to authenticated;

-- Resumen de cosecha por campaña, cultivo, calidad y destino
create view v_cosecha_resumen with (security_invoker = true) as
select e.empresa_id, e.campana_id, c.nombre as campana, e.cultivo_id, cu.nombre as cultivo,
  coalesce(e.calidad, 'Sin calidad') as calidad, e.destino_id, d.nombre as destino,
  count(*) as entregas,
  sum(e.kilos_netos) as kilos,
  sum(e.kilos_aceite) as kilos_aceite,
  case when sum(e.kilos_netos) filter (where e.rendimiento_pct is not null) > 0
       then round(sum(e.kilos_aceite) / sum(e.kilos_netos) filter (where e.rendimiento_pct is not null) * 100, 2) end as rendimiento_medio,
  sum(e.importe) as importe,
  sum(e.kilos_netos) filter (where e.precio is null) as kilos_sin_precio,
  case when sum(e.kilos_netos) filter (where e.importe is not null) > 0
       then round(sum(e.importe) / sum(e.kilos_netos) filter (where e.importe is not null), 4) end as precio_medio_kg
from entregas_cosecha e
join cultivos cu on cu.id = e.cultivo_id
left join campanas c on c.id = e.campana_id
left join destinos_cosecha d on d.id = e.destino_id
group by e.empresa_id, e.campana_id, c.nombre, e.cultivo_id, cu.nombre, coalesce(e.calidad, 'Sin calidad'), e.destino_id, d.nombre;

-- Reparto de cada entrega entre sus recintos (por kilos o por superficie) para rentabilidad por parcela
create view v_entregas_recintos with (security_invoker = true) as
select e.id as entrega_id, e.empresa_id, e.campana_id, e.cultivo_id, er.recinto_id, r.parcela_id,
  coalesce(er.kilos, e.kilos_netos * coalesce(r.superficie_sigpac_ha,0) / nullif(sum(coalesce(r.superficie_sigpac_ha,0)) over (partition by e.id),0)) as kilos,
  e.importe * coalesce(er.kilos / nullif(e.kilos_netos,0),
     coalesce(r.superficie_sigpac_ha,0) / nullif(sum(coalesce(r.superficie_sigpac_ha,0)) over (partition by e.id),0)) as importe
from entregas_cosecha e
join entregas_cosecha_recintos er on er.entrega_id = e.id
join recintos r on r.id = er.recinto_id;

-- Avisos: entregas sin liquidar con más de 60 días
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
from entregas_cosecha where precio is null and fecha < current_date - 60 group by empresa_id;

-- ---------------------------------------------------------------------
-- 3. Si se crean campañas o cambian sus fechas, se reasignan partes y entregas
-- ---------------------------------------------------------------------
create or replace function recalcular_campanas_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := coalesce(new.empresa_id, old.empresa_id);
begin
  if tg_op = 'UPDATE' and new.fecha_inicio = old.fecha_inicio and new.fecha_fin = old.fecha_fin
     and new.cultivo_id is not distinct from old.cultivo_id then
    return null;
  end if;
  update partes_trabajo_recintos ptr
     set campana_id = campana_de(p.empresa_id, cultivo_de_recinto(ptr.recinto_id, p.fecha), p.fecha)
    from partes_trabajo p
   where p.id = ptr.parte_trabajo_id and p.empresa_id = v_emp;
  update partes_trabajo p set campana_id = coalesce(
      (select x.campana_id from partes_trabajo_recintos x where x.parte_trabajo_id = p.id and x.campana_id is not null limit 1),
      campana_de(p.empresa_id, null, p.fecha))
   where p.empresa_id = v_emp;
  update entregas_cosecha e set campana_id = campana_de(e.empresa_id, e.cultivo_id, e.fecha)
   where e.empresa_id = v_emp;
  return null;
end $$;
revoke execute on function recalcular_campanas_empresa() from public, anon, authenticated;
drop trigger if exists trg_campanas_recalcular on campanas;
create trigger trg_campanas_recalcular after insert or update or delete on campanas
  for each row execute function recalcular_campanas_empresa();
