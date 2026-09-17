import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Acceso',
  description: 'Inicia sesión o crea tu cuenta en Local B para gestionar tu negocio.',
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      {children}
    </div>
  );
}
