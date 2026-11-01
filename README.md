# Cultivix V1

SaaS de gestión agrícola para pequeños y medianos agricultores. **La IA propone, el agricultor confirma.**

Stack: **Next.js 16** (app web instalable en el móvil) · **Supabase** (base de datos, login, archivos) · **Claude** (asistente y lectura de albaranes) · **Vercel** (hosting).

---

## Qué hace esta versión

| Pantalla | Qué hace | Decisiones que cumple |
|---|---|---|
| **Inicio** | Saludo, parcela detectada por GPS, tiempo (Open-Meteo), 4 botones grandes, avisos (ITV, seguros, partes pendientes, stock negativo) y sugerencias ("el año pasado por estas fechas…", lluvia, viento) | UX-002, UX-006, UX-007, FLUJO 1 |
| **Registrar trabajo** | "Empiezo ahora" (cronómetro + recorrido GPS) o "Ya lo hice". Propone labor, parcela por GPS, tractor y apero habituales. Calcula coste estimado | FLUJO 2, DEC-009..013 |
| **Asistente** | Voz o texto: "ayer traté La Mesa con cobre a 3 kilos" → tarjeta para confirmar con un toque. También responde consultas sobre tus datos y lee en voz alta | FLUJO 6, UX-004, DEC-051 |
| **Escanear documento** | Foto o PDF de un albarán → proveedor, productos, cantidades y precios → al confirmar crea productos y suma stock | FLUJO 4, DEC-015/020/034 |
| **Tratamientos** | Al registrar una labor de tipo tratamiento/abonado pide productos (primero los que tienes en stock), dosis/ha y calcula cantidades | FLUJO 3, DEC-036..041 |
| **Cuaderno de campo** | Se genera solo. Exporta CSV y PDF | DEC-042, FLUJO-050 |
| **Parcelas + SIGPAC** | Importa recintos de SIGPAC por referencia o "estoy en la parcela" (GPS): superficie, uso, pendiente y linderos automáticos | DEC-005/031 |
| **Mapa** | Ortofoto PNOA, tus recintos coloreados por cultivo, fotos geolocalizadas, historial por recinto | DEC-056 |
| **Maquinaria** | Máquinas y aperos con coste/hora, documentos con caducidad (avisos 30 días antes), averías | DEC-014 |
| **Economía** | Coste por parcela, por labor y €/ha; compras por albarán, con o sin factura | DEC-006/016/019 |
| **Equipo** | Invitar por email/WhatsApp con rol. Trabajadores: interfaz simplificada, sin datos económicos; sus partes requieren validación | FLUJO-059..065 |
| **Sin cobertura** | Los partes se guardan en el móvil y se envían solos al volver la red. La app se instala en la pantalla de inicio | FLUJO-005/057 |

### Seguridad
Cada usuario **solo ve las empresas a las que pertenece** (Row Level Security en todas las tablas). Esto sustituye a las políticas `using (true)` del prototipo, que permitían a cualquiera con la clave pública leer y escribir los datos de todas las empresas. La clave de la IA vive solo en el servidor.

---

## Puesta en marcha (≈ 20 minutos)

### 1. Base de datos (Supabase)
En tu proyecto Supabase → **SQL Editor**, ejecuta en este orden el contenido de `supabase/migrations/`:

1. `0000_limpiar_prototipo.sql` — ⚠️ **borra las tablas del prototipo** y sus datos demo. Si prefieres no tocarlas, crea un proyecto Supabase nuevo y sáltate este archivo.
2. `0001_esquema.sql`
3. `0002_seguridad_y_funciones.sql`
4. `0003_storage.sql`
5. `0004_datos_base.sql`

### 2. Login (Supabase → Authentication → URL Configuration)
- **Site URL**: la dirección de Vercel (ej. `https://cultivix.vercel.app`)
- **Redirect URLs**: añade la misma y `http://localhost:3000`
- Si quieres probar rápido sin confirmar emails: Authentication → Providers → Email → desactiva *Confirm email* (vuelve a activarlo antes de tener clientes).

### 3. Clave de IA
Crea una API key en https://console.anthropic.com (requiere añadir saldo; cada interacción del asistente cuesta céntimos).

### 4. Subir a GitHub y desplegar en Vercel
```bash
git init && git add . && git commit -m "Cultivix V1"
git remote add origin https://github.com/JoseCultivix/cultivix.git
git push -u origin main
```
En Vercel → *Add New Project* → importa el repositorio → **Environment Variables**:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la clave *publishable* / *anon* |
| `ANTHROPIC_API_KEY` | tu clave de Anthropic |

Deploy. Abre la URL en el móvil → menú del navegador → *Añadir a pantalla de inicio*.

### 5. Primer uso
- Regístrate en la app → asistente de alta (3 pasos) → importa tus parcelas de SIGPAC.
- **Atajo**: si quieres tu explotación del prototipo ya cargada (fincas, 11 parcelas, Pepe, José Antonio Molina, maquinaria, labores), regístrate primero y luego ejecuta `supabase/semilla_mi_explotacion.sql` en el SQL Editor. Después vincula cada parcela con SIGPAC desde *Parcelas → + SIGPAC → Guardar en: (tu parcela)*.

### Desarrollo en tu ordenador
```bash
npm install
cp .env.example .env.local   # y rellena las claves
npm run dev                  # http://localhost:3000
```

---

## Estructura
```
app/(app)/            pantallas con menú inferior (inicio, asistente, trabajo, partes, mapa, …)
app/api/asistente     IA: frase → propuesta de parte/aplicación/observación, o respuesta a consulta
app/api/escanear      IA: foto/PDF de albarán → líneas de compra
app/api/sigpac        consulta al servicio SIGPAC del FEGA
components/           ParteEditor (tarjeta de confirmación), AppProvider (sesión, catálogos, GPS, offline)
lib/                  geo (detección de recinto), offline (cola), servidor (Claude/Supabase en servidor)
supabase/migrations   esquema, seguridad, funciones
```

**Funciones clave en la base de datos**: `crear_empresa` (alta guiada), `guardar_parte` (parte completo en una transacción, idempotente para offline), `registrar_albaran`, `validar_partes`, `aceptar_invitaciones`. **Vistas**: `v_partes_coste`, `v_stock_productos`, `v_cuaderno_campo`, `v_alertas`.

---

## Siguientes fases (por orden de impacto)
1. **Ingresos y rentabilidad real**: tickets y liquidaciones de almazara (escaneo IA), PAC repartida por recintos (FLUJO 5, DEC-017/024).
2. **Facturas**: agrupar albaranes en factura, pagos y tesorería (DEC-021/025).
3. **Cierre de jornada**: aviso al final del día con partes abiertos para cerrar en un toque (FLUJO 8).
4. **SIEX**: exportación en el formato oficial a partir del cuaderno (requiere la especificación vigente del MAPA).
5. **Técnicos y cooperativas** con permisos delegados (DEC-058..063).
6. **Suscripciones con Stripe** (20 €/mes, 10 € vía cooperativa).
7. AEMET (estaciones oficiales) y Sentinel (índices de vegetación).

## Limitaciones conocidas de la V1
- El recorrido GPS se registra mientras la pantalla de trabajo está abierta (una web no puede seguir el GPS con el móvil bloqueado; para eso hará falta app nativa).
- El dictado por voz usa el reconocimiento del propio móvil (Chrome Android y Safari iOS).
- Los trabajadores pueden ver el coste/hora de la maquinaria a través de los catálogos; los importes de partes, compras y precios sí están ocultos.
