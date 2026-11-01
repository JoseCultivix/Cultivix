-- =====================================================================
-- CULTIVIX · 0001 · ESQUEMA V1
-- Basado en "Modelo_Datos_Cultivix_v1" y "Decisiones de Arquitectura".
--  · Todo cuelga de empresa_id (Decisión 4).
--  · Unidad mínima: recinto SIGPAC (DEC-005).
--  · Cultivo = recinto + campaña (DEC-007).
--  · Partes con varios recintos, trabajadores, máquinas y aperos (DEC-009..011).
--  · Compra ≠ aplicación; stock lógico = compras − aplicaciones − bajas (DEC-034/037).
--  · La IA propone, el usuario valida (DEC-051): tabla acciones_ia.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- utilidades
-- ---------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- =====================================================================
-- BLOQUE A · NÚCLEO
-- =====================================================================
create table empresas (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  nombre_comercial   text,
  nif                text,
  direccion          text,
  codigo_postal      text,
  municipio          text,
  provincia          text,
  comunidad_autonoma text,
  pais               text not null default 'España',
  telefono           text,
  email              text,
  tipo_explotacion   text not null default 'propia'
                     check (tipo_explotacion in ('propia','arrendada','gestionada','mixta')),
  regimen_fiscal     text check (regimen_fiscal in ('modulos','estimacion_directa')),
  iva_es_coste       boolean not null default true,
  plan_suscripcion   text not null default 'basico'
                     check (plan_suscripcion in ('basico','cooperativa','tecnico','almazara','prueba')),
  activa             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_empresas_upd before update on empresas
  for each row execute function set_updated_at();

-- Perfil ampliado de auth.users
create table usuarios (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  nombre        text,
  apellidos     text,
  telefono      text,
  empresa_activa_id uuid references empresas(id) on delete set null,
  ultimo_acceso timestamptz,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_usuarios_upd before update on usuarios
  for each row execute function set_updated_at();

-- Roles: propietario > administrador > encargado > trabajador ; tecnico (permisos delegados)
create table empresa_usuarios (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  rol         text not null default 'trabajador'
              check (rol in ('propietario','administrador','encargado','trabajador','tecnico')),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (empresa_id, usuario_id)
);

-- Invitaciones por email (el invitado entra con ese email y queda dado de alta)
create table invitaciones (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  email       text not null,
  rol         text not null default 'trabajador'
              check (rol in ('administrador','encargado','trabajador','tecnico')),
  trabajador_id uuid,           -- se vincula si el invitado es un trabajador ya creado
  invitado_por uuid references usuarios(id) on delete set null,
  aceptada    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (empresa_id, email)
);

create table modulos_empresa (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  modulo      text not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (empresa_id, modulo)
);

-- =====================================================================
-- BLOQUE B · TERRITORIO
-- =====================================================================
create table fincas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  descripcion text,
  tipo        text not null default 'propia' check (tipo in ('propia','arrendada','gestionada')),
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_fincas_upd before update on fincas
  for each row execute function set_updated_at();

create table propietarios_terceros (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  nif         text,
  telefono    text,
  email       text,
  direccion   text,
  observaciones text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table parcelas (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references empresas(id) on delete cascade,
  finca_id            uuid references fincas(id) on delete set null,
  nombre              text not null,
  referencia_interna  text,
  tipo_propiedad      text not null default 'propia'
                      check (tipo_propiedad in ('propia','arrendada','terceros')),
  propietario_tercero_id uuid references propietarios_terceros(id) on delete set null,
  superficie_total_ha numeric(12,4),
  latitud_centro      double precision,
  longitud_centro     double precision,
  activa              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_parcelas_upd before update on parcelas
  for each row execute function set_updated_at();

create table recintos (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  parcela_id         uuid not null references parcelas(id) on delete cascade,
  provincia_sigpac   int,
  municipio_sigpac   int,
  agregado_sigpac    int not null default 0,
  zona_sigpac        int not null default 0,
  poligono_sigpac    int,
  parcela_sigpac     int,
  recinto_sigpac     int,
  referencia_sigpac  text generated always as (
      coalesce(provincia_sigpac::text,'?')||':'||coalesce(municipio_sigpac::text,'?')||':'||
      agregado_sigpac::text||':'||zona_sigpac::text||':'||coalesce(poligono_sigpac::text,'?')||':'||
      coalesce(parcela_sigpac::text,'?')||':'||coalesce(recinto_sigpac::text,'?')) stored,
  uso_sigpac         text,
  superficie_sigpac_ha numeric(12,4),
  pendiente_media    numeric(6,2),
  coef_regadio       numeric(6,2),
  -- Geometría GeoJSON (lon/lat, EPSG:4326/4258) + caja envolvente para detectar recinto por GPS
  geometria          jsonb,
  bbox_min_lon       double precision,
  bbox_min_lat       double precision,
  bbox_max_lon       double precision,
  bbox_max_lat       double precision,
  centro_lat         double precision,
  centro_lon         double precision,
  fuente             text not null default 'manual' check (fuente in ('manual','sigpac')),
  fecha_importacion  timestamptz,
  activo             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index ux_recintos_ref on recintos(empresa_id, referencia_sigpac)
  where provincia_sigpac is not null and recinto_sigpac is not null;
create index idx_recintos_parcela on recintos(parcela_id);
create index idx_recintos_bbox on recintos(empresa_id, bbox_min_lon, bbox_max_lon, bbox_min_lat, bbox_max_lat);
create trigger trg_recintos_upd before update on recintos
  for each row execute function set_updated_at();

-- Catálogo global de cultivos (empresa_id null) + cultivos propios
create table cultivos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid references empresas(id) on delete cascade,
  nombre      text not null,
  codigo      text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index ux_cultivos_global on cultivos(nombre) where empresa_id is null;

create table campanas (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas(id) on delete cascade,
  nombre       text not null,
  fecha_inicio date not null,
  fecha_fin    date not null,
  activa       boolean not null default false,
  created_at   timestamptz not null default now(),
  check (fecha_fin >= fecha_inicio)
);
create unique index ux_campana_activa on campanas(empresa_id) where activa;

create table recinto_cultivos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  recinto_id    uuid not null references recintos(id) on delete cascade,
  cultivo_id    uuid not null references cultivos(id) on delete restrict,
  campana_id    uuid not null references campanas(id) on delete cascade,
  superficie_ha numeric(12,4),
  variedad      text,
  anio_plantacion int,
  regadio       boolean not null default false,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (recinto_id, campana_id, cultivo_id)
);

-- =====================================================================
-- BLOQUE C · OPERACIONES
-- =====================================================================
create table trabajadores (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas(id) on delete cascade,
  usuario_id      uuid references usuarios(id) on delete set null, -- si tiene acceso a la app
  nombre          text not null,
  apellidos       text,
  dni             text,
  telefono        text,
  email           text,
  tipo_trabajador text not null default 'fijo'
                  check (tipo_trabajador in ('propietario','fijo','eventual','autonomo')),
  coste_hora      numeric(10,2) not null default 0,
  fecha_alta      date,
  fecha_baja      date,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index ux_trabajador_usuario on trabajadores(empresa_id, usuario_id) where usuario_id is not null;
create trigger trg_trabajadores_upd before update on trabajadores
  for each row execute function set_updated_at();

alter table invitaciones
  add constraint fk_inv_trabajador foreign key (trabajador_id) references trabajadores(id) on delete set null;

create table maquinaria (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  nombre             text not null,
  tipo               text,            -- tractor, atomizador, cuba, remolque, vibrador...
  marca              text,
  modelo             text,
  matricula          text,
  numero_serie       text,
  numero_roma        text,
  coste_hora         numeric(10,2) not null default 0,
  propia_o_alquilada text not null default 'propia' check (propia_o_alquilada in ('propia','alquilada','tercero')),
  fecha_compra       date,
  activa             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_maquinaria_upd before update on maquinaria
  for each row execute function set_updated_at();

create table aperos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  tipo        text,
  marca       text,
  modelo      text,
  coste_hora  numeric(10,2) not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_aperos_upd before update on aperos
  for each row execute function set_updated_at();

create table maquinaria_documentos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references empresas(id) on delete cascade,
  maquinaria_id    uuid references maquinaria(id) on delete cascade,
  apero_id         uuid references aperos(id) on delete cascade,
  tipo_documento   text not null check (tipo_documento in
                   ('itv','seguro','roma','ficha_tecnica','permiso_circulacion','inspeccion_equipo_fito','otro')),
  nombre_documento text,
  archivo_path     text,
  fecha_emision    date,
  fecha_caducidad  date,
  dias_aviso       int not null default 30,
  created_at       timestamptz not null default now(),
  check (maquinaria_id is not null or apero_id is not null)
);

create table averias (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  maquinaria_id uuid references maquinaria(id) on delete cascade,
  apero_id      uuid references aperos(id) on delete cascade,
  fecha         date not null default current_date,
  descripcion   text not null,
  coste         numeric(12,2),
  proveedor     text,
  estado        text not null default 'abierta' check (estado in ('abierta','reparada')),
  created_at    timestamptz not null default now()
);

create table mantenimientos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  maquinaria_id uuid not null references maquinaria(id) on delete cascade,
  fecha         date not null default current_date,
  tipo          text,
  descripcion   text,
  coste         numeric(12,2),
  horas_motor   numeric(10,1),
  proximo_mantenimiento date,
  created_at    timestamptz not null default now()
);

-- Catálogo de labores. "categoria" decide si la labor genera aplicación (cuaderno de campo).
create table labores (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references empresas(id) on delete cascade,
  nombre                text not null,
  categoria             text not null default 'labor'
                        check (categoria in ('labor','tratamiento','fertilizacion','herbicida','recoleccion','poda','riego','transporte','otro')),
  cultivo_aplicable     text,     -- null = todos
  requiere_maquinaria   boolean not null default true,
  maquinaria_habitual_id uuid references maquinaria(id) on delete set null,
  apero_habitual_id     uuid references aperos(id) on delete set null,
  palabras_clave        text[],   -- ayuda a la IA / búsqueda: {'cultivador','cultivar'}
  activa                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (empresa_id, nombre)
);
create trigger trg_labores_upd before update on labores
  for each row execute function set_updated_at();

create table clientes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  nif         text,
  telefono    text,
  email       text,
  direccion   text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Parte de trabajo: tabla principal de operaciones
create table partes_trabajo (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas(id) on delete cascade,
  campana_id      uuid references campanas(id) on delete set null,
  labor_id        uuid references labores(id) on delete set null,
  fecha           date not null default current_date,
  inicio          timestamptz,
  fin             timestamptz,
  horas_totales   numeric(8,2),
  estado          text not null default 'pendiente'
                  check (estado in ('en_curso','borrador','pendiente','validado','descartado')),
  origen          text not null default 'manual' check (origen in ('manual','voz','ia','trabajador','offline')),
  tipo_trabajo    text not null default 'propio' check (tipo_trabajo in ('propio','terceros')),
  cliente_id      uuid references clientes(id) on delete set null,
  precio_terceros numeric(12,2),
  cobrado         boolean,
  observaciones   text,
  gps_inicio      jsonb,           -- {lat, lon, precision}
  gps_fin         jsonb,
  recorrido       jsonb,           -- [[lon,lat,ts],...]
  creado_por      uuid references usuarios(id) on delete set null default auth.uid(),
  validado_por    uuid references usuarios(id) on delete set null,
  validado_en     timestamptz,
  id_local        text,            -- id generado en el móvil (offline) para evitar duplicados
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index ux_partes_id_local on partes_trabajo(empresa_id, id_local) where id_local is not null;
create index idx_partes_empresa_fecha on partes_trabajo(empresa_id, fecha desc);
create index idx_partes_estado on partes_trabajo(empresa_id, estado);
create trigger trg_partes_upd before update on partes_trabajo
  for each row execute function set_updated_at();

-- Calcula horas a partir de inicio/fin y asigna campaña activa si falta
create or replace function partes_before_write() returns trigger
language plpgsql as $$
begin
  if new.inicio is not null and new.fin is not null and new.fin > new.inicio then
    new.horas_totales := round(extract(epoch from (new.fin - new.inicio)) / 3600.0, 2);
  end if;
  if new.campana_id is null then
    select id into new.campana_id from campanas
     where empresa_id = new.empresa_id and new.fecha between fecha_inicio and fecha_fin
     order by activa desc limit 1;
  end if;
  return new;
end $$;
create trigger trg_partes_bw before insert or update on partes_trabajo
  for each row execute function partes_before_write();

create table partes_trabajo_recintos (
  id               uuid primary key default gen_random_uuid(),
  parte_trabajo_id uuid not null references partes_trabajo(id) on delete cascade,
  recinto_id       uuid not null references recintos(id) on delete restrict,
  superficie_trabajada_ha numeric(12,4),
  detectado_gps    boolean not null default false,
  unique (parte_trabajo_id, recinto_id)
);

create table partes_trabajo_trabajadores (
  id               uuid primary key default gen_random_uuid(),
  parte_trabajo_id uuid not null references partes_trabajo(id) on delete cascade,
  trabajador_id    uuid not null references trabajadores(id) on delete restrict,
  horas            numeric(8,2),
  coste_hora       numeric(10,2),
  coste_total      numeric(12,2) generated always as (coalesce(horas,0) * coalesce(coste_hora,0)) stored,
  unique (parte_trabajo_id, trabajador_id)
);

create table partes_trabajo_maquinaria (
  id               uuid primary key default gen_random_uuid(),
  parte_trabajo_id uuid not null references partes_trabajo(id) on delete cascade,
  maquinaria_id    uuid not null references maquinaria(id) on delete restrict,
  horas            numeric(8,2),
  coste_hora       numeric(10,2),
  coste_total      numeric(12,2) generated always as (coalesce(horas,0) * coalesce(coste_hora,0)) stored,
  unique (parte_trabajo_id, maquinaria_id)
);

create table partes_trabajo_aperos (
  id               uuid primary key default gen_random_uuid(),
  parte_trabajo_id uuid not null references partes_trabajo(id) on delete cascade,
  apero_id         uuid not null references aperos(id) on delete restrict,
  horas            numeric(8,2),
  coste_hora       numeric(10,2),
  coste_total      numeric(12,2) generated always as (coalesce(horas,0) * coalesce(coste_hora,0)) stored,
  unique (parte_trabajo_id, apero_id)
);

-- Rellena horas y coste/hora por defecto en las líneas (DEC-012: costes automáticos)
create or replace function lineas_parte_defaults() returns trigger
language plpgsql as $$
declare v_horas numeric;
begin
  select horas_totales into v_horas from partes_trabajo where id = new.parte_trabajo_id;
  if new.horas is null then new.horas := v_horas; end if;
  if new.coste_hora is null then
    if tg_table_name = 'partes_trabajo_trabajadores' then
      select coste_hora into new.coste_hora from trabajadores where id = new.trabajador_id;
    elsif tg_table_name = 'partes_trabajo_maquinaria' then
      select coste_hora into new.coste_hora from maquinaria where id = new.maquinaria_id;
    elsif tg_table_name = 'partes_trabajo_aperos' then
      select coste_hora into new.coste_hora from aperos where id = new.apero_id;
    end if;
  end if;
  return new;
end $$;
create trigger trg_ptt_def before insert on partes_trabajo_trabajadores for each row execute function lineas_parte_defaults();
create trigger trg_ptm_def before insert on partes_trabajo_maquinaria   for each row execute function lineas_parte_defaults();
create trigger trg_pta_def before insert on partes_trabajo_aperos       for each row execute function lineas_parte_defaults();

-- Cuando se cierra un parte (cambian horas), actualiza horas de las líneas que seguían el total
create or replace function partes_propagar_horas() returns trigger
language plpgsql as $$
begin
  if new.horas_totales is distinct from old.horas_totales then
    update partes_trabajo_trabajadores set horas = new.horas_totales
     where parte_trabajo_id = new.id and (horas is null or horas = old.horas_totales);
    update partes_trabajo_maquinaria set horas = new.horas_totales
     where parte_trabajo_id = new.id and (horas is null or horas = old.horas_totales);
    update partes_trabajo_aperos set horas = new.horas_totales
     where parte_trabajo_id = new.id and (horas is null or horas = old.horas_totales);
  end if;
  return new;
end $$;
create trigger trg_partes_prop after update on partes_trabajo
  for each row execute function partes_propagar_horas();

-- =====================================================================
-- BLOQUE D · COMPRAS (mínimo V1) — el albarán es el documento principal (DEC-015/020)
-- =====================================================================
create table proveedores (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  nif         text,
  telefono    text,
  email       text,
  direccion   text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index ux_proveedor_nombre on proveedores(empresa_id, lower(nombre));

create table productos (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  nombre            text not null,
  tipo              text not null default 'otro'
                    check (tipo in ('fitosanitario','fertilizante','herbicida','bioestimulante','semilla','gasoil','otro')),
  materia_activa    text,
  numero_registro   text,      -- nº registro MAPA (fitosanitarios)
  unidad            text not null default 'kg' check (unidad in ('kg','l','ud','t','g','ml')),
  dosis_habitual_ha numeric(12,3),
  plazo_seguridad_dias int,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index ux_producto_nombre on productos(empresa_id, lower(nombre));
create trigger trg_productos_upd before update on productos
  for each row execute function set_updated_at();

create table documentos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  tipo          text not null default 'otro'
                check (tipo in ('albaran','factura','ticket','liquidacion','pac','dat','contrato','nomina','maquinaria','foto','otro')),
  nombre        text,
  archivo_path  text,            -- ruta en Storage (bucket "documentos")
  mime_type     text,
  estado_ia     text not null default 'sin_procesar'
                check (estado_ia in ('sin_procesar','procesado','validado','error')),
  datos_extraidos jsonb,
  subido_por    uuid references usuarios(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);

create table albaranes_compra (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  proveedor_id  uuid references proveedores(id) on delete set null,
  documento_id  uuid references documentos(id) on delete set null,
  numero        text,
  fecha         date not null default current_date,
  base_imponible numeric(12,2),
  iva           numeric(12,2),
  total         numeric(12,2),
  con_factura   boolean not null default true,  -- DEC-016: sin factura → rentabilidad sí, fiscal no
  estado        text not null default 'pendiente_factura'
                check (estado in ('pendiente_factura','facturado','pagado')),
  observaciones text,
  created_at    timestamptz not null default now()
);

create table albaranes_compra_lineas (
  id            uuid primary key default gen_random_uuid(),
  albaran_id    uuid not null references albaranes_compra(id) on delete cascade,
  producto_id   uuid references productos(id) on delete set null,
  descripcion   text not null,
  cantidad      numeric(12,3),
  unidad        text,
  precio_unitario numeric(12,4),
  importe       numeric(12,2),
  recinto_id    uuid references recintos(id) on delete set null  -- asignación directa de coste (opcional)
);

-- Bajas / ajustes manuales de stock (roturas, caducados, inventario)
create table stock_ajustes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  fecha       date not null default current_date,
  cantidad    numeric(12,3) not null,   -- positivo suma, negativo resta
  motivo      text,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- BLOQUE E · APLICACIONES (fitos / fertilización) → cuaderno de campo
-- Una aplicación siempre va ligada a un parte (recintos, fecha, máquina, aplicador).
-- =====================================================================
create table aplicaciones (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references empresas(id) on delete cascade,
  parte_trabajo_id uuid not null unique references partes_trabajo(id) on delete cascade,
  tipo             text not null default 'fitosanitario'
                   check (tipo in ('fitosanitario','fertilizacion','herbicida','bioestimulante','otro')),
  plaga_o_motivo   text,
  volumen_caldo_l_ha numeric(10,2),
  observaciones    text,
  created_at       timestamptz not null default now()
);

create table aplicaciones_productos (
  id             uuid primary key default gen_random_uuid(),
  aplicacion_id  uuid not null references aplicaciones(id) on delete cascade,
  producto_id    uuid not null references productos(id) on delete restrict,
  dosis_ha       numeric(12,3),
  unidad_dosis   text,               -- kg/ha, l/ha
  cantidad_total numeric(12,3),      -- consumo de stock
  unique (aplicacion_id, producto_id)
);

-- =====================================================================
-- BLOQUE F · FOTOS, OBSERVACIONES, IA
-- =====================================================================
create table fotografias (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  archivo_path  text not null,
  lat           double precision,
  lon           double precision,
  recinto_id    uuid references recintos(id) on delete set null,
  parte_trabajo_id uuid references partes_trabajo(id) on delete set null,
  maquinaria_id uuid references maquinaria(id) on delete set null,
  descripcion   text,
  tomada_en     timestamptz not null default now(),
  subida_por    uuid references usuarios(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);

create table observaciones_agronomicas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  recinto_id  uuid references recintos(id) on delete set null,
  fecha       date not null default current_date,
  tipo        text,   -- plaga, enfermedad, helada, granizo, riego, otro
  descripcion text not null,
  fotografia_id uuid references fotografias(id) on delete set null,
  creado_por  uuid references usuarios(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

-- Registro de todo lo que propone la IA y lo que decide el usuario (DEC-051, auditoría)
create table acciones_ia (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas(id) on delete cascade,
  usuario_id   uuid references usuarios(id) on delete set null default auth.uid(),
  canal        text not null default 'texto' check (canal in ('texto','voz','foto','documento')),
  entrada      text,
  propuesta    jsonb,
  estado       text not null default 'propuesta'
               check (estado in ('propuesta','confirmada','modificada','descartada','respuesta')),
  registro_tabla text,
  registro_id  uuid,
  modelo       text,
  created_at   timestamptz not null default now()
);

-- =====================================================================
-- VISTAS
-- =====================================================================

-- Coste de cada parte (mano de obra + maquinaria + aperos + productos)
create view v_partes_coste with (security_invoker = true) as
select p.id as parte_trabajo_id, p.empresa_id,
  coalesce((select sum(coste_total) from partes_trabajo_trabajadores where parte_trabajo_id = p.id),0) as coste_mano_obra,
  coalesce((select sum(coste_total) from partes_trabajo_maquinaria   where parte_trabajo_id = p.id),0) +
  coalesce((select sum(coste_total) from partes_trabajo_aperos       where parte_trabajo_id = p.id),0) as coste_maquinaria,
  coalesce((select sum(ap.cantidad_total * pr.precio_medio)
              from aplicaciones a
              join aplicaciones_productos ap on ap.aplicacion_id = a.id
              left join lateral (
                 select case when sum(l.cantidad) > 0 then sum(l.importe)/sum(l.cantidad) end as precio_medio
                   from albaranes_compra_lineas l where l.producto_id = ap.producto_id) pr on true
             where a.parte_trabajo_id = p.id),0)::numeric(12,2) as coste_productos
from partes_trabajo p;

-- Stock lógico (DEC-037): compras − aplicaciones + ajustes
create view v_stock_productos with (security_invoker = true) as
select pr.id as producto_id, pr.empresa_id, pr.nombre, pr.tipo, pr.unidad,
  coalesce(c.comprado,0)  as comprado,
  coalesce(a.aplicado,0)  as aplicado,
  coalesce(j.ajustes,0)   as ajustes,
  coalesce(c.comprado,0) - coalesce(a.aplicado,0) + coalesce(j.ajustes,0) as stock,
  c.ultima_compra, c.precio_medio
from productos pr
left join lateral (
  select sum(l.cantidad) comprado, max(ab.fecha) ultima_compra,
         case when sum(l.cantidad) > 0 then round(sum(l.importe)/sum(l.cantidad),4) end precio_medio
    from albaranes_compra_lineas l join albaranes_compra ab on ab.id = l.albaran_id
   where l.producto_id = pr.id) c on true
left join lateral (
  select sum(ap.cantidad_total) aplicado
    from aplicaciones_productos ap
    join aplicaciones apl on apl.id = ap.aplicacion_id
    join partes_trabajo p on p.id = apl.parte_trabajo_id
   where ap.producto_id = pr.id and p.estado <> 'descartado') a on true
left join lateral (
  select sum(cantidad) ajustes from stock_ajustes where producto_id = pr.id) j on true;

-- Cuaderno de campo (DEC-042): una fila por recinto × producto aplicado, solo partes validados
create view v_cuaderno_campo with (security_invoker = true) as
select p.empresa_id, p.id as parte_trabajo_id, p.fecha, p.campana_id,
  r.id as recinto_id, r.referencia_sigpac, pa.nombre as parcela, r.superficie_sigpac_ha,
  ptr.superficie_trabajada_ha,
  (select string_agg(cu.nombre, ', ') from recinto_cultivos rc join cultivos cu on cu.id = rc.cultivo_id
     where rc.recinto_id = r.id and rc.campana_id = p.campana_id) as cultivo,
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

-- Alertas para la pantalla de inicio (UX-006): nunca bloquean
create view v_alertas with (security_invoker = true) as
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
from v_stock_productos s where s.stock < 0;
