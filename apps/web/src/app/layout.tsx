import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Local B — Panel de gestión',
  description: 'Plataforma SaaS de reservas, pedidos y gestión para negocios de belleza y servicios',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body>{children}</body>
    </html>
  );
}
