'use client';

import { useState } from 'react';
import { Plus, Copy, Check, Pencil, Trash2 } from 'lucide-react';

const mockPrompts = [
  {
    id: '1',
    name: 'Saludo inicial',
    category: 'General',
    content: 'Hola 👋 Bienvenido a {negocio}. Soy tu asistente virtual. ¿En qué te puedo ayudar?\n\n1️⃣ Agendar una cita\n2️⃣ Ver servicios y precios\n3️⃣ Consultar disponibilidad\n4️⃣ Hablar con un humano',
    isActive: true,
  },
  {
    id: '2',
    name: 'Confirmación de reserva',
    category: 'Reservas',
    content: '✅ ¡Reserva confirmada!\n\n📅 {fecha}\n⏰ {hora}\n💇 {servicio}\n👤 Con {profesional}\n\nTe enviaremos un recordatorio 24h antes. Si necesitas cancelar o mover tu cita, escríbeme.',
    isActive: true,
  },
  {
    id: '3',
    name: 'Recordatorio 24h',
    category: 'Notificaciones',
    content: '⏰ Recordatorio: mañana tienes cita en {negocio}\n\n📅 {fecha} a las {hora}\n💇 {servicio}\n\n¿Todo bien? Responde SI para confirmar o CANCELAR si no puedes asistir.',
    isActive: true,
  },
  {
    id: '4',
    name: 'Post-venta / Reseña',
    category: 'Seguimiento',
    content: 'Hola {nombre} 😊 ¿Qué tal quedó tu {servicio}? Tu opinión nos ayuda a mejorar.\n\nSi te gustó, te agradecemos un ⭐ en Google: {link_resena}',
    isActive: false,
  },
];

export default function PromptPage() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400 max-w-2xl">
          Tus prompts y plantillas de mensaje. Cópialos y pégalos en tu agente, o úsalos como plantillas
          para notificaciones automáticas.
        </p>
        <button className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> Nuevo prompt
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {mockPrompts.map((prompt) => (
          <div key={prompt.id} className="card-accent flex flex-col">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="font-semibold text-white">{prompt.name}</h3>
                <p className="mono-label">{prompt.category}</p>
              </div>
              {prompt.isActive ? (
                <span className="badge-active">ACTIVO</span>
              ) : (
                <span className="badge text-slate-500 border border-slate-700">INACTIVO</span>
              )}
            </div>
            <pre className="flex-1 text-xs text-slate-400 bg-surface rounded-lg p-3 mt-2 mb-3 whitespace-pre-wrap font-mono overflow-hidden max-h-32">
              {prompt.content}
            </pre>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCopy(prompt.id, prompt.content)}
                className="btn-secondary text-xs py-1 px-2 flex-1"
              >
                {copiedId === prompt.id ? (
                  <><Check className="h-3 w-3 text-emerald-400" /> Copiado</>
                ) : (
                  <><Copy className="h-3 w-3" /> Copiar prompt</>
                )}
              </button>
              <button className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-surface-100">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-surface-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
