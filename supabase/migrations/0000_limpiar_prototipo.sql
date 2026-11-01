-- =====================================================================
-- CULTIVIX · 0000 · LIMPIEZA DEL PROTOTIPO
-- ---------------------------------------------------------------------
-- ¡ATENCIÓN! Este script BORRA las tablas del prototipo anterior
-- (las creadas a mano con las "Query Supabase") y sus datos de demo.
-- Ejecútalo SOLO UNA VEZ, antes de 0001, y solo si no tienes datos reales.
-- Si prefieres no tocar nada, crea un proyecto Supabase nuevo y sáltate
-- este archivo.
-- =====================================================================

drop table if exists partes_trabajo_maquinaria   cascade;
drop table if exists partes_trabajo_trabajadores cascade;
drop table if exists partes_trabajo_parcelas     cascade;
drop table if exists partes_trabajo              cascade;
drop table if exists grupos_parcelas_detalle     cascade;
drop table if exists grupos_parcelas             cascade;
drop table if exists parcelas                    cascade;
drop table if exists fincas                      cascade;
drop table if exists labores                     cascade;
drop table if exists maquinaria                  cascade;
drop table if exists aperos                      cascade;
drop table if exists clientes                    cascade;
drop table if exists usuarios                    cascade;
drop table if exists usuarios_app                cascade;
drop table if exists trabajadores                cascade;
drop table if exists empresas                    cascade;
