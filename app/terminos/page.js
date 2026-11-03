import Link from "next/link";
import { PaginaLegal } from "@/components/TextoLegal";
import { RESPONSABLE } from "@/lib/legal";

export const metadata = { title: "Condiciones de uso · Cultivix" };

export default function Terminos() {
  return (
    <PaginaLegal titulo="Condiciones de uso (versión de prueba)" actualizado="3 de noviembre de 2026">
      <h2>1. Qué es esto</h2>
      <p>
        Cultivix es una aplicación de gestión agrícola en <b>fase de pruebas</b> promovida por {RESPONSABLE.nombre}. Durante esta fase el uso es{" "}
        <b>gratuito y por invitación</b>, y su objetivo es probar la aplicación y recoger opiniones para mejorarla.
      </p>

      <h2>2. Qué puedes esperar</h2>
      <ul>
        <li>Es una versión en desarrollo: puede tener errores, cambiar funciones o interrumpirse puntualmente.</li>
        <li>
          Haremos lo razonable para que tus datos estén seguros y disponibles, pero <b>te recomendamos descargar tus datos periódicamente</b> (Ajustes → Tus datos)
          y conservar tus documentos originales.
        </li>
        <li>Si en el futuro el servicio pasa a ser de pago, te avisaremos con antelación y podrás decidir si continúas, llevándote tus datos.</li>
      </ul>

      <h2>3. Lo que te pedimos</h2>
      <ul>
        <li>Usar la app para gestionar tu explotación de forma lícita y con datos veraces.</li>
        <li>Cuidar tu contraseña y no compartir tu cuenta.</li>
        <li>Informar a tus trabajadores antes de invitarles (ver la política de privacidad, punto 8).</li>
      </ul>

      <h2>4. La inteligencia artificial y los cálculos son una ayuda</h2>
      <p>
        El asistente, la lectura de documentos, las sugerencias, los costes y la rentabilidad son <b>orientativos</b>. Revisa siempre la información antes de
        confirmarla. Las decisiones técnicas (productos, dosis, plazos de seguridad) y las obligaciones legales y fiscales (cuaderno de campo, SIEX, PAC,
        declaraciones) son responsabilidad del titular de la explotación y de sus asesores. Cultivix no sustituye el criterio de un técnico.
      </p>

      <h2>5. Tus datos son tuyos</h2>
      <p>
        Los datos que introduces son tuyos. Solo los usamos para prestarte el servicio, como se explica en la{" "}
        <Link href="/privacidad" className="font-semibold text-olivo-700">
          política de privacidad
        </Link>
        . Puedes descargarlos o borrarlos cuando quieras.
      </p>

      <h2>6. Responsabilidad</h2>
      <p>
        Al tratarse de una versión de prueba gratuita, Cultivix se ofrece «tal cual», y en la medida que lo permite la ley no nos hacemos responsables de daños
        derivados de errores de la aplicación, pérdidas de datos o decisiones tomadas a partir de la información que muestra.
      </p>

      <h2>7. Contacto</h2>
      <p>
        Para cualquier duda: {RESPONSABLE.email}. También puedes usar el botón de sugerencias dentro de la app. Estas condiciones se rigen por la ley española.
      </p>
    </PaginaLegal>
  );
}
