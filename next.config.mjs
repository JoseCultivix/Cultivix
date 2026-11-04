/** @type {import('next').NextConfig} */
// Origen de Supabase permitido (el de producción o, en pruebas locales, el que se configure)
const supa = (() => {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    return u.hostname.endsWith(".supabase.co") ? "" : ` ${u.origin} ${u.origin.replace(/^http/, "ws")}`;
  } catch {
    return "";
  }
})();
const cabecerasSeguridad = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // La app solo usa cámara, micrófono y GPS de su propio origen
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: https://*.supabase.co https://www.ign.es https://*.tile.openstreetmap.org https://sigpac-hubcloud.es${supa}`,
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.open-meteo.com https://nominatim.openstreetmap.org${supa}`,
      "font-src 'self' data:",
      "worker-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: cabecerasSeguridad }];
  },
};
export default nextConfig;
