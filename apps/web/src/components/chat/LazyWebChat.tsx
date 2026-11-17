'use client';

import dynamic from 'next/dynamic';

// El chat flotante no hace falta para el primer pintado de ninguna página del
// dashboard: se descarga aparte (fuera del bundle inicial) y solo en el cliente.
const WebChat = dynamic(() => import('./WebChat').then((m) => m.WebChat), { ssr: false });

export function LazyWebChat() {
  return <WebChat />;
}
