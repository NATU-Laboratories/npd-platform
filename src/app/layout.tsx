import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Proyectos NPD · NATU", template: "%s · Proyectos NPD" },
  description: "Plataforma de gestión de nuevos desarrollos de NATU Laboratories",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0f5f5a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full">
      <body className="min-h-full">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
