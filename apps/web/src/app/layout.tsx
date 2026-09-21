import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { PostHogProvider } from '@/lib/posthog-provider';

export const metadata: Metadata = {
  title: { default: 'Local B — Panel de gestión', template: '%s | Local B' },
  description: 'Plataforma SaaS de reservas, pedidos y gestión para negocios locales. Bots inteligentes, agenda online y más.',
  keywords: ['reservas', 'booking', 'SaaS', 'chatbot', 'gestión', 'negocios'],
  openGraph: {
    title: 'Local B',
    description: 'Automatiza tu negocio con bots inteligentes, agenda online y gestión integral.',
    type: 'website',
    locale: 'es_AR',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>
        <PostHogProvider>
          <AuthProvider>{children}</AuthProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
