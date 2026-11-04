-- 0011 · Materias activas del Registro del MAPA (para que el técnico recomiende materia activa, no producto comercial)

-- Nombre normalizado de una materia activa a partir de un trozo del «formulado»
-- p. ej. "OXICLORURO DE COBRE 50% (EXPR. EN CU) [WP] P/P" -> "OXICLORURO DE COBRE"
create or replace function fito_ma_nombre(p text) returns text
language sql immutable parallel safe as $$
  select nullif(upper(translate(trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(trim(p), '\s+[0-9][0-9.,]*\s*(%|g|mg|cc|ml|ufc|x|e|ppm).*$', '', 'i'),
        '\s*\((EXP|COMO|ADICION)[^)]*\)?', '', 'gi'),
      '\s*\([^)]*$', '')),
    'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')), '')
$$;

create or replace view v_fito_materias with (security_invoker = true) as
  select fp.id as producto_id, fito_ma_nombre(x) as materia
  from fito_productos fp, unnest(string_to_array(fp.formulado, '+')) x
  where fp.estado = 'Vigente' and fito_ma_nombre(x) is not null;

-- Buscar materias activas; indica si alguna formulación está autorizada en los cultivos dados
create or replace function fito_buscar_materia(p_texto text, p_codigos text[] default '{}')
returns table (materia text, productos integer, autorizada boolean)
language sql stable security invoker set search_path = public as $$
  with cand as (
    select m.materia, count(distinct m.producto_id)::int as productos
    from v_fito_materias m
    where length(trim(coalesce(p_texto, ''))) >= 2
      and m.materia like '%' || upper(translate(trim(p_texto), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) || '%'
    group by 1
  )
  select c.materia, c.productos,
         case when cardinality(p_codigos) = 0 then null else exists (
           select 1 from v_fito_materias m2
           join fito_usos u on u.producto_id = m2.producto_id
           join fito_cultivos fc on fc.id = u.cultivo_id
           cross join unnest(p_codigos) k(codigo)
           where m2.materia = c.materia and fito_relacion(fc.codigo, k.codigo) is not null) end
  from cand c
  order by 3 desc nulls last, 2 desc
  limit 25
$$;

-- Plagas/usos autorizados para una materia activa en los cultivos dados
create or replace function fito_plagas_materia(p_materia text, p_codigos text[])
returns table (codigo_cultivo text, agente text, tipo_agente text, productos integer, plazo_max integer)
language sql stable security invoker set search_path = public as $$
  select k.codigo, fa.nombre, fa.tipo, count(distinct m.producto_id)::int, max(u.plazo_dias)
  from v_fito_materias m
  join fito_usos u on u.producto_id = m.producto_id
  join fito_cultivos fc on fc.id = u.cultivo_id
  join fito_agentes fa on fa.id = u.agente_id
  cross join unnest(p_codigos) k(codigo)
  where m.materia = p_materia and fito_relacion(fc.codigo, k.codigo) is not null
  group by 1, 2, 3
  order by 1, 4 desc, 2
$$;

-- Productos comerciales vigentes con esa materia activa, autorizados en esos cultivos (y para esa plaga si se indica)
create or replace function fito_productos_materia(p_materia text, p_codigos text[], p_agente text default null)
returns table (registro text, producto text, formulado text, titular text, dosis_min numeric, dosis_max numeric, unidad text, plazo_dias integer)
language sql stable security invoker set search_path = public as $$
  select fp.registro, fp.nombre, fp.formulado, fp.titular,
         min(u.dosis_min), max(u.dosis_max), mode() within group (order by u.unidad), max(u.plazo_dias)
  from v_fito_materias m
  join fito_productos fp on fp.id = m.producto_id
  join fito_usos u on u.producto_id = fp.id
  join fito_cultivos fc on fc.id = u.cultivo_id
  join fito_agentes fa on fa.id = u.agente_id
  cross join unnest(p_codigos) k(codigo)
  where m.materia = p_materia
    and fito_relacion(fc.codigo, k.codigo) is not null
    and (p_agente is null or fa.nombre = p_agente)
  group by 1, 2, 3, 4
  order by 2
  limit 60
$$;

revoke execute on function fito_buscar_materia(text, text[]), fito_plagas_materia(text, text[]), fito_productos_materia(text, text[], text) from public, anon;
grant execute on function fito_buscar_materia(text, text[]), fito_plagas_materia(text, text[]), fito_productos_materia(text, text[], text) to authenticated;
grant select on v_fito_materias to authenticated;
