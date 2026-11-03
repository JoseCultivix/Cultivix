import { PaginaLegal } from "@/components/TextoLegal";
import { RESPONSABLE } from "@/lib/legal";

export const metadata = { title: "Política de privacidad · Cultivix" };

export default function Privacidad() {
  return (
    <PaginaLegal titulo="Política de privacidad" actualizado="3 de noviembre de 2026">
      <p>
        Cultivix es una aplicación de gestión agrícola en <b>fase de pruebas</b>, de uso gratuito y por invitación. Aquí te explicamos, de forma clara, qué datos
        guardamos, para qué y qué derechos tienes, conforme al Reglamento General de Protección de Datos (RGPD, UE 2016/679) y la Ley Orgánica 3/2018 (LOPDGDD).
      </p>

      <h2>1. Quién es el responsable</h2>
      <p>
        {RESPONSABLE.nombre}, promotor del proyecto {RESPONSABLE.proyecto}. Contacto para cualquier cuestión de privacidad:{" "}
        <a className="font-semibold text-olivo-700" href={`mailto:${RESPONSABLE.email}`}>
          {RESPONSABLE.email}
        </a>
        .
      </p>

      <h2>2. Qué datos tratamos</h2>
      <ul>
        <li>
          <b>Cuenta:</b> email, nombre y contraseña (cifrada; nunca la vemos).
        </li>
        <li>
          <b>Explotación:</b> fincas, parcelas y recintos SIGPAC, cultivos, campañas, maquinaria, productos, partes de trabajo, tratamientos, compras, cosechas y
          liquidaciones que tú registras.
        </li>
        <li>
          <b>Trabajadores:</b> nombre, teléfono, coste por hora y los partes que registran.
        </li>
        <li>
          <b>Ubicación (GPS):</b> solo si das permiso en el móvil. Se usa para detectar en qué parcela estás y, mientras tienes abierta la pantalla de un trabajo
          en curso, para guardar el recorrido y saber qué parcelas has trabajado.
        </li>
        <li>
          <b>Fotos y documentos</b> que subes (albaranes, tickets de cosecha, fotos de campo, documentación de maquinaria).
        </li>
        <li>
          <b>Lo que escribes o dictas al asistente y a AgronomIA</b> (incluidas las fotos de cultivos que le envíes), sus propuestas y respuestas.
        </li>
        <li>
          <b>Sugerencias</b> que envías desde la app y datos técnicos mínimos (fecha de último acceso, tipo de dispositivo).
        </li>
      </ul>

      <h2>3. Para qué y con qué base legal</h2>
      <table>
        <thead>
          <tr>
            <th>Finalidad</th>
            <th>Base legal</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Prestarte el servicio: guardar y mostrar tus datos, calcular costes, cuaderno de campo, cosechas…</td>
            <td>Ejecución del acuerdo de uso que aceptas al registrarte (art. 6.1.b RGPD)</td>
          </tr>
          <tr>
            <td>Usar el GPS del móvil</td>
            <td>Tu consentimiento, que das o retiras en los permisos del móvil (art. 6.1.a)</td>
          </tr>
          <tr>
            <td>Mejorar la aplicación con tus sugerencias y estadísticas de uso agregadas</td>
            <td>Interés legítimo en mejorar el producto durante las pruebas (art. 6.1.f)</td>
          </tr>
        </tbody>
      </table>
      <p>
        <b>No vendemos tus datos, no hacemos publicidad y no los usamos para nada distinto de lo anterior.</b> Las sugerencias de la inteligencia artificial son
        orientativas y nunca se guarda nada sin que lo confirmes.
      </p>

      <h2>4. Quién nos ayuda a prestar el servicio (encargados del tratamiento)</h2>
      <table>
        <thead>
          <tr>
            <th>Proveedor</th>
            <th>Para qué</th>
            <th>Dónde</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Supabase</td>
            <td>Base de datos, inicio de sesión y almacenamiento de archivos</td>
            <td>Unión Europea (Irlanda)</td>
          </tr>
          <tr>
            <td>Vercel</td>
            <td>Alojamiento de la aplicación</td>
            <td>Servidores en la UE (Dublín); red global para archivos estáticos</td>
          </tr>
          <tr>
            <td>Anthropic (Claude)</td>
            <td>Interpretar lo que dices al asistente, responder a tus consultas de AgronomIA (con datos agronómicos de tu explotación, nunca económicos) y leer fotos de albaranes, tickets y cultivos, solo cuando usas esas funciones</td>
            <td>EE. UU.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Cuando un proveedor está fuera del Espacio Económico Europeo, la transferencia se ampara en el Marco de Privacidad de Datos UE-EE. UU. o en las cláusulas
        contractuales tipo aprobadas por la Comisión Europea, según el caso. Además, la app consulta servicios públicos sin enviar datos personales tuyos: SIGPAC
        (FEGA) para importar parcelas, Open-Meteo para el tiempo (coordenadas aproximadas) e IGN/OpenStreetMap para los mapas.
      </p>

      <h2>5. Cuánto tiempo los guardamos</h2>
      <p>
        Mientras mantengas tu cuenta. Si la borras, se eliminan tus datos de inmediato de la base de datos; las copias de seguridad técnicas de los proveedores se
        renuevan en pocos días. Recuerda que la normativa agrícola puede obligarte a conservar el cuaderno de campo durante varios años: descárgalo antes de borrar.
      </p>

      <h2>6. Seguridad</h2>
      <ul>
        <li>Conexión cifrada (HTTPS) siempre.</li>
        <li>Cada explotación está aislada: nadie de otra explotación puede ver tus datos, ni siquiera conociendo la dirección de la app.</li>
        <li>Permisos por rol: los trabajadores solo ven sus propios partes y nunca datos económicos.</li>
        <li>Los archivos se guardan en un almacén privado; solo se accede con tu sesión y mediante enlaces temporales.</li>
      </ul>

      <h2>7. Tus derechos</h2>
      <p>
        Puedes acceder a tus datos, rectificarlos, borrarlos, oponerte o limitar su uso y llevártelos (portabilidad). Desde <b>Más → Ajustes → Tus datos</b> puedes
        descargar todos los datos de tu explotación y borrar la explotación o tu cuenta. Para cualquier otra petición, escribe a {RESPONSABLE.email}. Si crees que no
        hemos atendido bien tu solicitud, puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).
      </p>

      <h2>8. Si usas Cultivix con trabajadores</h2>
      <p>
        Si das de alta a trabajadores, tú (la explotación) eres responsable de sus datos y Cultivix actúa en tu nombre. Antes de que usen la app debes informarles,
        de forma expresa y clara, de que sus partes de trabajo quedan registrados y de que, si activan el GPS, la ubicación se usa para identificar las parcelas
        trabajadas (art. 90 LOPDGDD). El uso del GPS es siempre opcional y se puede desactivar en el móvil.
      </p>

      <h2>9. Cookies y almacenamiento en el móvil</h2>
      <p>
        No usamos cookies publicitarias ni de analítica de terceros. La app guarda en tu móvil solo lo necesario para funcionar: tu sesión, una copia de tus
        catálogos para abrir sin cobertura y los registros pendientes de enviar. Son técnicos y estrictamente necesarios, por lo que no requieren consentimiento.
      </p>

      <h2>10. Menores</h2>
      <p>Cultivix está dirigido a profesionales. No debe usarse por menores de 14 años.</p>
    </PaginaLegal>
  );
}
