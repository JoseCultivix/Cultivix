-- 0010 · Planificación de tareas en el calendario
create table if not exists tareas_planificadas (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  fecha          date not null,
  hora           time,
  labor_id       uuid references labores(id) on delete set null,
  recinto_ids    uuid[] not null default '{}',
  trabajador_ids uuid[] not null default '{}',
  datos          jsonb not null default '{}'::jsonb,   -- lo previsto: maquinaria, aperos, productos y dosis, horas, riego…
  notas          text,
  estado         text not null default 'pendiente' check (estado in ('pendiente','hecha','cancelada')),
  parte_id       uuid references partes_trabajo(id) on delete set null,
  grupo_id       uuid,                                -- tareas creadas juntas al repetir
  hecha_en       timestamptz,
  hecha_por      uuid references usuarios(id) on delete set null,
  creado_por     uuid references usuarios(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_tareas_empresa_fecha on tareas_planificadas(empresa_id, fecha);
drop trigger if exists trg_tareas_upd on tareas_planificadas;
create trigger trg_tareas_upd before update on tareas_planificadas for each row execute function set_updated_at();

alter table tareas_planificadas enable row level security;
drop policy if exists tar_sel on tareas_planificadas;
drop policy if exists tar_wr on tareas_planificadas;
create policy tar_sel on tareas_planificadas for select using (es_miembro(empresa_id));
create policy tar_wr  on tareas_planificadas for all using (es_gestor_o_tecnico(empresa_id)) with check (es_gestor_o_tecnico(empresa_id));

-- Un trabajador puede dar por hecha una tarea que tiene asignada (o sin asignar)
create or replace function completar_tarea(p_tarea uuid, p_parte uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t tareas_planificadas;
begin
  select * into t from tareas_planificadas where id = p_tarea;
  if t.id is null or not es_miembro(t.empresa_id) then raise exception 'Tarea no encontrada'; end if;
  if not es_gestor_o_tecnico(t.empresa_id)
     and cardinality(t.trabajador_ids) > 0
     and not exists (select 1 from trabajadores w where w.empresa_id = t.empresa_id and w.usuario_id = auth.uid() and w.id = any(t.trabajador_ids)) then
    raise exception 'Esta tarea no está asignada a ti';
  end if;
  update tareas_planificadas
     set estado = 'hecha', hecha_en = now(), hecha_por = auth.uid(),
         parte_id = (select id from partes_trabajo where id = p_parte and empresa_id = t.empresa_id)
   where id = p_tarea;
end $$;
revoke execute on function completar_tarea(uuid, uuid) from public, anon;
grant execute on function completar_tarea(uuid, uuid) to authenticated;

-- La exportación de datos incluye las tareas
create or replace function exportar_datos_empresa(p_empresa uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare r jsonb := jsonb_build_object('exportado_en', now(), 'formato', 'Cultivix JSON v1'); t text; v jsonb;
begin
  if not es_admin(p_empresa) then raise exception 'Solo el titular o administrador puede exportar los datos'; end if;
  foreach t in array array['empresas','fincas','parcelas','recintos','campanas','recinto_cultivos','trabajadores',
    'maquinaria','aperos','maquinaria_documentos','averias','mantenimientos','labores','clientes','partes_trabajo',
    'proveedores','productos','albaranes_compra','stock_ajustes','aplicaciones','documentos','fotografias',
    'observaciones_agronomicas','destinos_cosecha','entregas_cosecha','liquidaciones_cosecha',
    'asesores','planes_abonado','consultas_agronomia','tareas_planificadas'] loop
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
