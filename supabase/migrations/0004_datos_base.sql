-- =====================================================================
-- CULTIVIX · 0004 · CATÁLOGOS GLOBALES
-- =====================================================================
insert into cultivos (empresa_id, nombre, codigo) values
  (null, 'Olivar',          'OV'),
  (null, 'Pistacho',        'PI'),
  (null, 'Almendro',        'AL'),
  (null, 'Espárrago verde', 'ES'),
  (null, 'Viñedo',          'VI'),
  (null, 'Cereal',          'CE'),
  (null, 'Cítricos',        'CI'),
  (null, 'Frutales',        'FR'),
  (null, 'Hortícolas',      'HO'),
  (null, 'Barbecho',        'BA')
on conflict do nothing;
