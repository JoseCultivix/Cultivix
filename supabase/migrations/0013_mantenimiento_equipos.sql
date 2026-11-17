-- 0013 · Historial de mantenimiento de máquinas y aperos (averías, aceite, revisiones, reparaciones…) enlazado con las compras

alter table mantenimientos alter column maquinaria_id drop not null;
alter table mantenimientos add column if not exists apero_id uuid references aperos(id) on delete cascade;
alter table mantenimientos add column if not exists estado text not null default 'hecho';
alter table mantenimientos add column if not exists fecha_fin date;
alter table mantenimientos add column if not exists donde text not null default 'propios';
alter table mantenimientos add column if not exists proveedor_id uuid references proveedores(id) on delete set null;
alter table mantenimientos add column if not exists trabajador_id uuid references trabajadores(id) on delete set null;
alter table mantenimientos add column if not exists horas_mano_obra numeric(8,2);
alter table mantenimientos add column if not exists observaciones text;
alter table mantenimientos add column if not exists proximo_horas numeric(10,1);
alter table mantenimientos add column if not exists creado_por uuid references usuarios(id) on delete set null default auth.uid();
alter table mantenimientos add column if not exists updated_at timestamptz not null default now();
update mantenimientos set tipo = 'otro' where tipo is null or tipo not in ('averia','aceite','revision','reparacion','neumaticos','otro');
alter table mantenimientos alter column tipo set default 'otro';
alter table mantenimientos alter column tipo set not null;
alter table mantenimientos drop constraint if exists mantenimientos_tipo_check;
alter table mantenimientos add constraint mantenimientos_tipo_check check (tipo in ('averia','aceite','revision','reparacion','neumaticos','otro'));
alter table mantenimientos drop constraint if exists mantenimientos_estado_check;
alter table mantenimientos add constraint mantenimientos_estado_check check (estado in ('pendiente','hecho'));
alter table mantenimientos drop constraint if exists mantenimientos_donde_check;
alter table mantenimientos add constraint mantenimientos_donde_check check (donde in ('propios','taller'));
alter table mantenimientos drop constraint if exists mantenimientos_equipo_check;
alter table mantenimientos add constraint mantenimientos_equipo_check check (num_nonnulls(maquinaria_id, apero_id) = 1);
create index if not exists idx_mant_maquina on mantenimientos(maquinaria_id, fecha desc);
create index if not exists idx_mant_apero on mantenimientos(apero_id, fecha desc);
drop trigger if exists trg_mant_upd on mantenimientos;
create trigger trg_mant_upd before update on mantenimientos for each row execute function set_updated_at();

-- Las averías antiguas pasan al historial
insert into mantenimientos (empresa_id, maquinaria_id, apero_id, fecha, tipo, descripcion, coste, estado, observaciones)
select empresa_id, maquinaria_id, apero_id, fecha, 'averia', descripcion, coste,
       case when estado = 'reparada' then 'hecho' else 'pendiente' end, proveedor
from averias a
where num_nonnulls(maquinaria_id, apero_id) = 1
  and not exists (select 1 from mantenimientos m where m.created_at = a.created_at and m.descripcion = a.descripcion);

-- Cualquier miembro (también un trabajador) puede avisar de una avería
drop policy if exists mantenimientos_aviso on mantenimientos;
create policy mantenimientos_aviso on mantenimientos for insert
  with check (es_miembro(empresa_id) and tipo = 'averia' and estado = 'pendiente');

-- Línea de compra ↔ reparación/mantenimiento
alter table albaranes_compra_lineas add column if not exists mantenimiento_id uuid references mantenimientos(id) on delete set null;
create index if not exists idx_lineas_mant on albaranes_compra_lineas(mantenimiento_id);

-- Horas de uso estimadas de cada máquina: última lectura del horómetro + horas de partes posteriores
create or replace view v_horas_equipo with (security_invoker = true) as
select m.id as maquinaria_id, m.empresa_id, lect.horas_motor as ultima_lectura, lect.fecha as fecha_lectura,
  case when lect.horas_motor is null then null else
    lect.horas_motor + coalesce((
      select sum(coalesce(ptm.horas, p.horas_totales, 0))
      from partes_trabajo_maquinaria ptm join partes_trabajo p on p.id = ptm.parte_trabajo_id
      where ptm.maquinaria_id = m.id and p.estado <> 'descartado' and p.fecha > lect.fecha), 0) end as horas_estimadas
from maquinaria m
left join lateral (
  select horas_motor, fecha from mantenimientos
  where maquinaria_id = m.id and horas_motor is not null
  order by fecha desc, created_at desc limit 1
) lect on true;

create or replace function guardar_compra(payload jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_emp  uuid := (payload->>'empresa_id')::uuid;
  v_alb  uuid := nullif(payload->>'id','')::uuid;
  v_prov uuid := nullif(payload->>'proveedor_id','')::uuid;
  v_tipo text := coalesce(nullif(payload->>'tipo_documento',''), 'albaran');
  v_prod uuid;
  v_lin  uuid;
  v_cat  text;
  v_ids  uuid[] := '{}';
  l jsonb;
  i jsonb;
begin
  if not es_gestor(v_emp) then raise exception 'Solo el titular o encargado puede registrar compras'; end if;
  if v_tipo not in ('albaran','factura','ticket') then v_tipo := 'albaran'; end if;

  if v_prov is null and coalesce(trim(payload->>'proveedor_nombre'),'') <> '' then
    select id into v_prov from proveedores where empresa_id = v_emp and lower(nombre) = lower(trim(payload->>'proveedor_nombre'));
    if v_prov is null then
      insert into proveedores (empresa_id, nombre, nif) values (v_emp, trim(payload->>'proveedor_nombre'), payload->>'proveedor_nif')
      returning id into v_prov;
    end if;
  end if;

  if v_alb is null then
    insert into albaranes_compra (empresa_id, proveedor_id, documento_id, tipo_documento, numero, fecha, base_imponible, iva, total, con_factura, observaciones)
    values (v_emp, v_prov, nullif(payload->>'documento_id','')::uuid, v_tipo, nullif(payload->>'numero',''),
            coalesce(nullif(payload->>'fecha','')::date, current_date),
            nullif(payload->>'base_imponible','')::numeric, nullif(payload->>'iva','')::numeric, nullif(payload->>'total','')::numeric,
            case when v_tipo = 'factura' then true else coalesce((payload->>'con_factura')::boolean, true) end,
            payload->>'observaciones')
    returning id into v_alb;
  else
    update albaranes_compra set proveedor_id = v_prov, tipo_documento = v_tipo, numero = nullif(payload->>'numero',''),
           fecha = coalesce(nullif(payload->>'fecha','')::date, fecha),
           base_imponible = nullif(payload->>'base_imponible','')::numeric, iva = nullif(payload->>'iva','')::numeric,
           total = nullif(payload->>'total','')::numeric,
           con_factura = case when v_tipo = 'factura' then true else coalesce((payload->>'con_factura')::boolean, con_factura) end
     where id = v_alb and empresa_id = v_emp;
    if not found then raise exception 'Compra no encontrada'; end if;
  end if;

  for l in select * from jsonb_array_elements(coalesce(payload->'lineas','[]'::jsonb)) loop
    v_cat := coalesce(nullif(l->>'categoria',''), nullif(l->>'tipo',''), 'otro');
    if v_cat not in ('fitosanitario','herbicida','fertilizante','bioestimulante','semilla','gasoil','repuesto','reparacion','material','servicio','energia','seguro','otro') then v_cat := 'otro'; end if;
    v_prod := nullif(l->>'producto_id','')::uuid;
    -- Solo los productos de almacén (y, si se indica, gasoil/repuestos/materiales con nombre) se crean en el catálogo
    if v_prod is null and coalesce(trim(l->>'producto_nombre'),'') <> ''
       and (compra_es_almacen(v_cat) or coalesce((l->>'crear_producto')::boolean, false)) then
      select id into v_prod from productos where empresa_id = v_emp and lower(nombre) = lower(trim(l->>'producto_nombre'));
      if v_prod is null then
        insert into productos (empresa_id, nombre, tipo, unidad)
        values (v_emp, trim(l->>'producto_nombre'),
                case when v_cat in ('fitosanitario','herbicida','fertilizante','bioestimulante','semilla','gasoil','repuesto','material') then v_cat else 'otro' end,
                coalesce(nullif(l->>'unidad',''),'kg'))
        returning id into v_prod;
      end if;
    end if;
    v_lin := nullif(l->>'id','')::uuid;
    if v_lin is not null then
      update albaranes_compra_lineas
         set producto_id = v_prod, categoria = v_cat, descripcion = coalesce(nullif(l->>'descripcion',''), l->>'producto_nombre', 'Línea'),
             cantidad = nullif(l->>'cantidad','')::numeric, unidad = nullif(l->>'unidad',''),
             precio_unitario = nullif(l->>'precio_unitario','')::numeric, importe = nullif(l->>'importe','')::numeric,
             lote = nullif(trim(l->>'lote'),''), recinto_id = null,
             mantenimiento_id = nullif(l->>'mantenimiento_id','')::uuid
       where id = v_lin and albaran_id = v_alb;
      if not found then v_lin := null; end if;
    end if;
    if v_lin is null then
      insert into albaranes_compra_lineas (albaran_id, producto_id, categoria, descripcion, cantidad, unidad, precio_unitario, importe, lote, mantenimiento_id)
      values (v_alb, v_prod, v_cat, coalesce(nullif(l->>'descripcion',''), l->>'producto_nombre', 'Línea'),
              nullif(l->>'cantidad','')::numeric, nullif(l->>'unidad',''),
              nullif(l->>'precio_unitario','')::numeric, nullif(l->>'importe','')::numeric, nullif(trim(l->>'lote'),''),
              nullif(l->>'mantenimiento_id','')::uuid)
      returning id into v_lin;
    end if;
    v_ids := v_ids || v_lin;

    -- Imputaciones (los productos de almacén no se imputan: su coste llega al aplicarlos)
    delete from compras_imputaciones where linea_id = v_lin;
    if not compra_es_almacen(v_cat) then
      for i in select * from jsonb_array_elements(coalesce(l->'imputaciones','[]'::jsonb)) loop
        insert into compras_imputaciones (empresa_id, linea_id, recinto_id, finca_id, maquinaria_id, apero_id, general, porcentaje)
        values (v_emp, v_lin,
                case when i->>'tipo' = 'recinto' then (i->>'id')::uuid end,
                case when i->>'tipo' = 'finca' then (i->>'id')::uuid end,
                case when i->>'tipo' = 'maquinaria' then (i->>'id')::uuid end,
                case when i->>'tipo' = 'apero' then (i->>'id')::uuid end,
                i->>'tipo' = 'general',
                nullif(i->>'porcentaje','')::numeric);
      end loop;
      -- Línea de una reparación sin imputación: va a la máquina o apero de esa reparación
      if jsonb_array_length(coalesce(l->'imputaciones','[]'::jsonb)) = 0 and nullif(l->>'mantenimiento_id','') is not null then
        insert into compras_imputaciones (empresa_id, linea_id, maquinaria_id, apero_id)
        select v_emp, v_lin, mt.maquinaria_id, mt.apero_id from mantenimientos mt
         where mt.id = (l->>'mantenimiento_id')::uuid and mt.empresa_id = v_emp;
      end if;
    end if;
  end loop;

  -- En una corrección, las líneas que ya no vienen se borran
  if nullif(payload->>'id','') is not null then
    delete from albaranes_compra_lineas where albaran_id = v_alb and not (id = any(v_ids));
  end if;

  if nullif(payload->>'documento_id','') is not null then
    update documentos set estado_ia = 'validado', tipo = v_tipo where id = (payload->>'documento_id')::uuid;
  end if;
  return v_alb;
end $$;
revoke execute on function guardar_compra(jsonb) from public, anon;
grant execute on function guardar_compra(jsonb) to authenticated;

-- Guardar una reparación o mantenimiento, con su gasto: compra nueva y/o líneas de compras ya registradas
create or replace function guardar_mantenimiento(payload jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_emp  uuid := (payload->>'empresa_id')::uuid;
  v_id   uuid := nullif(payload->>'id','')::uuid;
  v_maq  uuid := nullif(payload->>'maquinaria_id','')::uuid;
  v_ape  uuid := nullif(payload->>'apero_id','')::uuid;
  v_prov uuid;
  v_alb  uuid;
  v_compra jsonb;
  v_lineas jsonb := '[]'::jsonb;
  x jsonb;
begin
  if not es_gestor(v_emp) then raise exception 'Solo el titular o encargado puede registrar reparaciones'; end if;
  if coalesce(payload->>'donde','propios') = 'taller' and coalesce(trim(payload->>'taller'),'') <> '' then
    select id into v_prov from proveedores where empresa_id = v_emp and lower(nombre) = lower(trim(payload->>'taller'));
    if v_prov is null then
      insert into proveedores (empresa_id, nombre) values (v_emp, trim(payload->>'taller')) returning id into v_prov;
    end if;
  end if;

  if v_id is null then
    insert into mantenimientos (empresa_id, maquinaria_id, apero_id, tipo, estado, fecha, fecha_fin, descripcion, observaciones, donde,
                                proveedor_id, trabajador_id, horas_mano_obra, horas_motor, proximo_mantenimiento, proximo_horas)
    values (v_emp, v_maq, v_ape, coalesce(nullif(payload->>'tipo',''),'otro'), coalesce(nullif(payload->>'estado',''),'hecho'),
            coalesce(nullif(payload->>'fecha','')::date, current_date), nullif(payload->>'fecha_fin','')::date,
            payload->>'descripcion', payload->>'observaciones', coalesce(nullif(payload->>'donde',''),'propios'),
            v_prov, nullif(payload->>'trabajador_id','')::uuid, nullif(payload->>'horas_mano_obra','')::numeric,
            nullif(payload->>'horas_motor','')::numeric, nullif(payload->>'proximo_mantenimiento','')::date,
            nullif(payload->>'proximo_horas','')::numeric)
    returning id into v_id;
  else
    update mantenimientos set tipo = coalesce(nullif(payload->>'tipo',''), tipo), estado = coalesce(nullif(payload->>'estado',''), estado),
           fecha = coalesce(nullif(payload->>'fecha','')::date, fecha), fecha_fin = nullif(payload->>'fecha_fin','')::date,
           descripcion = payload->>'descripcion', observaciones = payload->>'observaciones',
           donde = coalesce(nullif(payload->>'donde',''), donde), proveedor_id = v_prov,
           trabajador_id = nullif(payload->>'trabajador_id','')::uuid, horas_mano_obra = nullif(payload->>'horas_mano_obra','')::numeric,
           horas_motor = nullif(payload->>'horas_motor','')::numeric, proximo_mantenimiento = nullif(payload->>'proximo_mantenimiento','')::date,
           proximo_horas = nullif(payload->>'proximo_horas','')::numeric
     where id = v_id and empresa_id = v_emp
     returning maquinaria_id, apero_id into v_maq, v_ape;
    if v_maq is null and v_ape is null then raise exception 'Reparación no encontrada'; end if;
  end if;

  -- Desenlazar líneas (siguen siendo gasto de la compra, pero ya no de esta reparación)
  update albaranes_compra_lineas l set mantenimiento_id = null
   where l.mantenimiento_id = v_id
     and l.id in (select (jsonb_array_elements_text(coalesce(payload->'lineas_quitar','[]'::jsonb)))::uuid);

  -- Enlazar líneas de compras ya registradas: pasan a imputarse a este equipo
  for x in select * from jsonb_array_elements(coalesce(payload->'lineas_enlazar','[]'::jsonb)) loop
    update albaranes_compra_lineas l set mantenimiento_id = v_id
      from albaranes_compra a
     where l.id = (x #>> '{}')::uuid and a.id = l.albaran_id and a.empresa_id = v_emp;
    if found then
      delete from compras_imputaciones where linea_id = (x #>> '{}')::uuid;
      if not compra_es_almacen((select categoria from albaranes_compra_lineas where id = (x #>> '{}')::uuid)) then
        insert into compras_imputaciones (empresa_id, linea_id, maquinaria_id, apero_id) values (v_emp, (x #>> '{}')::uuid, v_maq, v_ape);
      end if;
    end if;
  end loop;

  -- Compra nueva (factura del taller, repuestos…): se crea y sus líneas quedan enlazadas e imputadas al equipo
  v_compra := payload->'compra';
  if v_compra is not null and jsonb_typeof(v_compra) = 'object' and jsonb_array_length(coalesce(v_compra->'lineas','[]'::jsonb)) > 0 then
    for x in select * from jsonb_array_elements(v_compra->'lineas') loop
      v_lineas := v_lineas || jsonb_build_array(x || jsonb_build_object('mantenimiento_id', v_id, 'imputaciones', '[]'::jsonb));
    end loop;
    v_alb := guardar_compra(jsonb_build_object(
      'empresa_id', v_emp,
      'tipo_documento', coalesce(v_compra->>'tipo_documento','factura'),
      'proveedor_id', coalesce(nullif(v_compra->>'proveedor_id',''), v_prov::text),
      'proveedor_nombre', v_compra->>'proveedor_nombre',
      'numero', v_compra->>'numero',
      'fecha', coalesce(nullif(v_compra->>'fecha',''), payload->>'fecha'),
      'total', v_compra->'total',
      'con_factura', coalesce(v_compra->'con_factura', 'true'::jsonb),
      'documento_id', v_compra->>'documento_id',
      'lineas', v_lineas));
  end if;
  return v_id;
end $$;
revoke execute on function guardar_mantenimiento(jsonb) from public, anon;
grant execute on function guardar_mantenimiento(jsonb) to authenticated;

-- Alertas: averías sin reparar y mantenimientos que tocan
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
) x
union all
-- Averías sin reparar
select mt.empresa_id, 'averia_pendiente', 'alta',
  'Avería sin reparar: ' || coalesce(m.nombre, ap.nombre) || ' — ' || left(coalesce(mt.descripcion,''), 60),
  mt.fecha, '/maquinaria'
from mantenimientos mt
left join maquinaria m on m.id = mt.maquinaria_id
left join aperos ap on ap.id = mt.apero_id
where mt.estado = 'pendiente'
union all
-- Próximo mantenimiento por fecha o por horas (el último hecho de cada tipo en cada equipo)
select u.empresa_id, 'mantenimiento',
  case when (u.proximo_mantenimiento is not null and u.proximo_mantenimiento < current_date)
         or (u.proximo_horas is not null and h.horas_estimadas >= u.proximo_horas) then 'alta' else 'media' end,
  initcap(replace(u.tipo, '_', ' ')) || ' de ' || coalesce(m.nombre, ap.nombre) ||
    case when u.proximo_mantenimiento is not null and u.proximo_mantenimiento <= current_date + 15
           then case when u.proximo_mantenimiento < current_date then ' (vencido el ' else ' (toca el ' end || to_char(u.proximo_mantenimiento, 'DD/MM') || ')'
         else ' (a las ' || round(u.proximo_horas) || ' h; lleva unas ' || round(h.horas_estimadas) || ' h)' end,
  u.proximo_mantenimiento, '/maquinaria'
from (
  select distinct on (coalesce(maquinaria_id, apero_id), tipo) *
  from mantenimientos where estado = 'hecho'
  order by coalesce(maquinaria_id, apero_id), tipo, fecha desc, created_at desc
) u
left join maquinaria m on m.id = u.maquinaria_id
left join aperos ap on ap.id = u.apero_id
left join v_horas_equipo h on h.maquinaria_id = u.maquinaria_id
where (u.proximo_mantenimiento is not null and u.proximo_mantenimiento <= current_date + 15)
   or (u.proximo_horas is not null and h.horas_estimadas is not null and h.horas_estimadas >= u.proximo_horas - 10);
