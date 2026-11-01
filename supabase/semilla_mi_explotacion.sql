-- =====================================================================
-- CULTIVIX · SEMILLA OPCIONAL: tu explotación del prototipo
-- ---------------------------------------------------------------------
-- 1) Regístrate primero en la app con tu email.
-- 2) Cambia el email de abajo si hace falta y ejecuta este script en el
--    SQL Editor de Supabase. Crea la empresa con tus fincas, parcelas,
--    trabajadores, maquinaria y labores del prototipo.
-- 3) Después, en la app (Parcelas → Importar SIGPAC) podrás asociar a
--    cada parcela sus recintos SIGPAC reales con geometría.
-- =====================================================================
do $$
declare
  v_email text := 'joseibva@gmail.com';   -- <-- tu email de acceso
  v_uid uuid;
  v_emp uuid;
  v_camp uuid;
  v_olivar uuid; v_pist uuid;
  f record;
  v_finca uuid; v_parc uuid; v_rec uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then raise exception 'Primero regístrate en la app con %', v_email; end if;

  -- Actuar como ese usuario dentro de este bloque
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  update usuarios set nombre = 'José Antonio', apellidos = 'Ibáñez' where id = v_uid;

  v_emp := crear_empresa('Explotación José Antonio Ibáñez', null, null,
            array['Olivar','Pistacho'],
            array['Tractor principal','Vibrador'],
            array['Cultivador','Rastra','Kongskilde','Atomizador','Cuba herbicida','Remolque','Desbrozadora']);

  update maquinaria set coste_hora = 25 where empresa_id = v_emp and nombre = 'Tractor principal';
  update maquinaria set coste_hora = 30 where empresa_id = v_emp and nombre = 'Vibrador';
  update aperos set coste_hora = 18 where empresa_id = v_emp and nombre = 'Atomizador';
  update aperos set coste_hora = 10 where empresa_id = v_emp and nombre = 'Cuba herbicida';
  update aperos set coste_hora = 8  where empresa_id = v_emp and nombre = 'Remolque';
  update aperos set coste_hora = 12 where empresa_id = v_emp and nombre = 'Desbrozadora';
  update aperos set coste_hora = 6  where empresa_id = v_emp and nombre in ('Cultivador','Rastra','Kongskilde');

  insert into labores (empresa_id, nombre, categoria, requiere_maquinaria, palabras_clave,
                       maquinaria_habitual_id, apero_habitual_id)
  select v_emp, 'Kongskilde', 'labor', true, array['kongskilde','vibrocultor'],
         (select id from maquinaria where empresa_id = v_emp and nombre = 'Tractor principal'),
         (select id from aperos where empresa_id = v_emp and nombre = 'Kongskilde')
  on conflict do nothing;

  insert into trabajadores (empresa_id, nombre, tipo_trabajador, coste_hora) values
    (v_emp, 'Pepe', 'fijo', 12),
    (v_emp, 'José Antonio Molina', 'fijo', 12);

  select id into v_camp from campanas where empresa_id = v_emp and activa;
  select id into v_olivar from cultivos where empresa_id is null and nombre = 'Olivar';
  select id into v_pist   from cultivos where empresa_id is null and nombre = 'Pistacho';

  for f in select * from (values
      ('Finca olivar principal','Parcela 1',6.0,'O'),
      ('Finca olivar principal','Parcela 2',6.0,'O'),
      ('Finca olivar principal','Parcela 3',6.0,'O'),
      ('Finca olivar principal','Parcela 4',6.0,'O'),
      ('Olivar otras parcelas','Cequia',0.6,'O'),
      ('Olivar otras parcelas','La Ciudad',0.6,'O'),
      ('Olivar otras parcelas','Yeseras',1.0,'O'),
      ('La Mesa','La Mesa P1',3.5,'P'),
      ('La Mesa','La Mesa P2',3.5,'P'),
      ('Pistacho otras parcelas','Ventilla grandes',0.6,'P'),
      ('Pistacho otras parcelas','Ventilla pequeños',1.3,'P')
    ) as t(finca, parcela, ha, cult)
  loop
    select id into v_finca from fincas where empresa_id = v_emp and nombre = f.finca;
    if v_finca is null then
      insert into fincas (empresa_id, nombre) values (v_emp, f.finca) returning id into v_finca;
    end if;
    insert into parcelas (empresa_id, finca_id, nombre, superficie_total_ha)
    values (v_emp, v_finca, f.parcela, f.ha) returning id into v_parc;
    -- Recinto provisional (sin SIGPAC) para poder trabajar desde el primer día
    insert into recintos (empresa_id, parcela_id, superficie_sigpac_ha, uso_sigpac, fuente)
    values (v_emp, v_parc, f.ha, case f.cult when 'O' then 'OV' else 'FS' end, 'manual')
    returning id into v_rec;
    insert into recinto_cultivos (empresa_id, recinto_id, cultivo_id, campana_id, superficie_ha)
    values (v_emp, v_rec, case f.cult when 'O' then v_olivar else v_pist end, v_camp, f.ha);
  end loop;

  raise notice 'Empresa creada: %', v_emp;
end $$;
