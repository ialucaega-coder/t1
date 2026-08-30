'use client';

import { useState } from 'react';
import { Copy, Check, Search } from 'lucide-react';

const commands = [
  { category: 'Reservas', items: [
    { name: '/nueva-reserva', desc: 'Crea una reserva manual desde el panel' },
    { name: '/ver-agenda', desc: 'Muestra la agenda del día o de la semana' },
    { name: '/cancelar-reserva', desc: 'Cancela una reserva existente por ID' },
    { name: '/confirmar-reserva', desc: 'Confirma una reserva pendiente' },
    { name: '/mover-reserva', desc: 'Cambia fecha u hora de una reserva' },
    { name: '/bloquear-horario', desc: 'Bloquea un rango de horas para un profesional' },
    { name: '/desbloquear-horario', desc: 'Libera un horario previamente bloqueado' },
  ]},
  { category: 'Clientes', items: [
    { name: '/buscar-cliente', desc: 'Busca un cliente por nombre, email o teléfono' },
    { name: '/historial-cliente', desc: 'Muestra el historial de reservas y compras' },
    { name: '/agregar-cliente', desc: 'Registra un cliente nuevo manualmente' },
    { name: '/nota-cliente', desc: 'Agrega una nota interna al perfil del cliente' },
  ]},
  { category: 'Productos', items: [
    { name: '/stock', desc: 'Consulta el stock actual de un producto' },
    { name: '/actualizar-precio', desc: 'Cambia el precio de un producto o servicio' },
    { name: '/agregar-producto', desc: 'Crea un producto nuevo en el catálogo' },
    { name: '/desactivar-producto', desc: 'Oculta un producto del catálogo público' },
  ]},
  { category: 'Comunicación', items: [
    { name: '/enviar-recordatorio', desc: 'Envía recordatorio manual a un cliente' },
    { name: '/enviar-promo', desc: 'Envía una promoción a la lista de clientes' },
    { name: '/broadcast', desc: 'Mensaje masivo a un segmento de clientes' },
    { name: '/respuesta-rapida', desc: 'Configura una respuesta automática predefinida' },
  ]},
  { category: 'Reportes', items: [
    { name: '/reporte-diario', desc: 'Genera el reporte del día: reservas, ventas, no-shows' },
    { name: '/reporte-semanal', desc: 'Resumen de la semana con tendencias' },
    { name: '/top-servicios', desc: 'Ranking de servicios más reservados' },
    { name: '/top-clientes', desc: 'Clientes con más reservas o compras' },
  ]},
  { category: 'Sistema', items: [
    { name: '/estado', desc: 'Estado del bot y conexiones activas' },
    { name: '/reiniciar', desc: 'Reinicia el bot sin perder configuración' },
    { name: '/version', desc: 'Muestra la versión actual del sistema' },
    { name: '/backup', desc: 'Genera un respaldo de la configuración' },
    { name: '/logs', desc: 'Muestra los últimos 50 eventos del sistema' },
  ]},
];

export default function ComandosPage() {
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const copyToClipboard = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const allCommands = commands.flatMap(c => c.items.map(i => ({ ...i, category: c.category })));
  const filtered = search
    ? allCommands.filter(c => c.name.includes(search) || c.desc.toLowerCase().includes(search.toLowerCase()))
    : null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        Comandos que puedes usar desde el chat de tu bot o copiar para tu agente.
        Haz click en el ícono para copiar.
      </p>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Buscar comando..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-10"
        />
      </div>

      {filtered ? (
        <div className="space-y-1">
          {filtered.map((cmd) => (
            <CommandRow
              key={cmd.name}
              name={cmd.name}
              desc={cmd.desc}
              isCopied={copiedCmd === cmd.name}
              onCopy={() => copyToClipboard(cmd.name)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-slate-500 py-8 text-center">No se encontraron comandos</p>
          )}
        </div>
      ) : (
        commands.map((group) => (
          <div key={group.category}>
            <h3 className="mono-label mb-3">{group.category}</h3>
            <div className="space-y-1">
              {group.items.map((cmd) => (
                <CommandRow
                  key={cmd.name}
                  name={cmd.name}
                  desc={cmd.desc}
                  isCopied={copiedCmd === cmd.name}
                  onCopy={() => copyToClipboard(cmd.name)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function CommandRow({ name, desc, isCopied, onCopy }: {
  name: string; desc: string; isCopied: boolean; onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-slate-800 bg-surface-50 px-4 py-3 hover:border-slate-700 transition-colors">
      <code className="font-mono text-sm text-brand-400 min-w-[180px]">{name}</code>
      <p className="text-sm text-slate-400 flex-1">{desc}</p>
      <button
        onClick={onCopy}
        className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-surface-100 hover:text-white transition-colors"
      >
        {isCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
