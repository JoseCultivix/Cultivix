import "./globals.css";
import AppProvider from "@/components/AppProvider";

export const metadata = {
  title: "Cultivix",
  description: "Gestión agrícola sencilla con asistente inteligente",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Cultivix", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#374624",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className="min-h-dvh antialiased">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
