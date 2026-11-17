-- 0012 · Compras por tipo de gasto, lotes e imputación de costes (parcelas, fincas, máquinas, aperos o gasto general)

-- Tipos de producto de almacén (los gastos directos —reparaciones, servicios…— no necesitan producto)
alter table productos drop constraint if exists productos_tipo_check;
alter table productos add constraint productos_tipo_check
  check (tipo in ('fitosanitario','herbicida','fertilizante','bioestimulante','semilla','gasoil','repuesto','material','otro'));
alter table productos add column if not exists variedad text;                      -- semillas y plantones
alter table productos add column if not exists pasaporte_fitosanitario boolean;    -- plantones/semillas que lo requieren

-- Documento de compra: albarán, factura o ticket
alter table albaranes_compra add column if not exists tipo_documento text not null default 'albaran';
alter table albaranes_compra drop constraint if exists albaranes_compra_tipo_documento_check;
alter table albaranes_compra add constraint albaranes_compra_tipo_documento_check check (tipo_documento in ('albaran','factura','ticket'));
update albaranes_compra a set tipo_documento = d.tipo
  from documentos d where d.id = a.documento_id and d.tipo in ('albaran','factura','ticket') and a.tipo_documento = 'albaran';

-- Línea: tipo de gasto y lote
alter table albaranes_compra_lineas add column if not exists categoria text not null default 'otro';
alter table albaranes_compra_lineas drop constraint if exists albaranes_compra_lineas_categoria_check;
alter table albaranes_compra_lineas add constraint albaranes_compra_lineas_categoria_check check (categoria in ('fitosanitario','herbicida','fertilizante','bioestimulante','semilla','gasoil','repuesto','reparacion','material','servicio','energia','seguro','otro'));
alter table albaranes_compra_lineas add column if not exists lote text;
update albaranes_compra_lineas l set categoria = p.tipo from productos p where p.id = l.producto_id and l.categoria = 'otro' and p.tipo <> 'otro';

-- ¿Va al almacén (su coste llega a la parcela al aplicarlo en un parte)?
create or replace function compra_es_almacen(p_categoria text) returns boolean
language sql immutable as $$ select p_categoria in ('fitosanitario','herbicida','fertilizante','bioestimulante','semilla') $$;

-- Imputación de cada línea: a recintos, fincas, máquinas, aperos o gasto general (con % opcional)
create table if not exists compras_imputaciones (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  linea_id      uuid not null references albaranes_compra_lineas(id) on delete cascade,
  recinto_id    uuid references recintos(id) on delete cascade,
  finca_id      uuid references fincas(id) on delete cascade,
  maquinaria_id uuid references maquinaria(id) on delete cascade,
  apero_id      uuid references aperos(id) on delete cascade,
  general       boolean not null default false,
  porcentaje    numeric(6,2) check (porcentaje is null or (porcentaje > 0 and porcentaje <= 100)),
  created_at    timestamptz not null default now(),
  check (num_nonnulls(recinto_id, finca_id, maquinaria_id, apero_id) + (case when general then 1 else 0 end) = 1)
);
create index if not exists idx_compras_imp_linea on compras_imputaciones(linea_id);
create index if not exists idx_compras_imp_empresa on compras_imputaciones(empresa_id);
alter table compras_imputaciones enable row level security;
drop policy if exists cimp_all on compras_imputaciones;
create policy cimp_all on compras_imputaciones for all using (es_gestor(empresa_id)) with check (es_gestor(empresa_id));

-- La asignación directa antigua (línea → recinto) pasa a la tabla nueva
insert into compras_imputaciones (empresa_id, linea_id, recinto_id)
select a.empresa_id, l.id, l.recinto_id
  from albaranes_compra_lineas l join albaranes_compra a on a.id = l.albaran_id
 where l.recinto_id is not null
   and not exists (select 1 from compras_imputaciones i where i.linea_id = l.id);

-- Guardar una compra completa (nueva o corregida): cabecera, líneas e imputaciones
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
             lote = nullif(trim(l->>'lote'),''), recinto_id = null
       where id = v_lin and albaran_id = v_alb;
      if not found then v_lin := null; end if;
    end if;
    if v_lin is null then
      insert into albaranes_compra_lineas (albaran_id, producto_id, categoria, descripcion, cantidad, unidad, precio_unitario, importe, lote)
      values (v_alb, v_prod, v_cat, coalesce(nullif(l->>'descripcion',''), l->>'producto_nombre', 'Línea'),
              nullif(l->>'cantidad','')::numeric, nullif(l->>'unidad',''),
              nullif(l->>'precio_unitario','')::numeric, nullif(l->>'importe','')::numeric, nullif(trim(l->>'lote'),''))
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

-- Compatibilidad: el registro antiguo pasa por la función nueva
create or replace function registrar_albaran(payload jsonb) returns uuid
language sql security invoker set search_path = public as $$ select guardar_compra(payload) $$;
revoke execute on function registrar_albaran(jsonb) from public, anon;
grant execute on function registrar_albaran(jsonb) to authenticated;

-- La exportación de datos incluye las imputaciones
create or replace function exportar_datos_empresa(p_empresa uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare r jsonb := jsonb_build_object('exportado_en', now(), 'formato', 'Cultivix JSON v1'); t text; v jsonb;
begin
  if not es_admin(p_empresa) then raise exception 'Solo el titular o administrador puede exportar los datos'; end if;
  foreach t in array array['empresas','fincas','parcelas','recintos','campanas','recinto_cultivos','trabajadores',
    'maquinaria','aperos','maquinaria_documentos','averias','mantenimientos','labores','clientes','partes_trabajo',
    'proveedores','productos','albaranes_compra','stock_ajustes','aplicaciones','documentos','fotografias',
    'observaciones_agronomicas','destinos_cosecha','entregas_cosecha','liquidaciones_cosecha',
    'asesores','planes_abonado','consultas_agronomia','tareas_planificadas','compras_imputaciones'] loop
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
