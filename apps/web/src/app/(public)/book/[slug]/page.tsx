import type { Metadata } from 'next';
import { BookingFlow } from './BookingFlow';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const businessName = slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    title: `Reservar en ${businessName}`,
    description: `Reserva tu cita en ${businessName} de forma rápida y sencilla a través de Local B.`,
    openGraph: {
      title: `Reservar en ${businessName}`,
      description: `Agenda tu cita en ${businessName} en línea. Sin llamadas, sin esperas.`,
      type: 'website',
      locale: 'es_AR',
    },
  };
}

export default async function PublicBookingPage({ params }: PageProps) {
  const { slug } = await params;

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4">
        <h1 className="text-lg font-bold text-white capitalize">{slug.replace(/-/g, ' ')}</h1>
        <p className="text-xs text-slate-400">Reserva tu cita en línea</p>
      </header>
      <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full">
        <BookingFlow slug={slug} />
      </main>
      <footer className="border-t border-slate-800 px-6 py-4 text-center">
        <p className="text-[10px] text-slate-500">Powered by Local B</p>
      </footer>
    </div>
  );
}
