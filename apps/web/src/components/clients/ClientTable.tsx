import { type Client } from '@/constants/clients';
import { ClientRow } from './ClientRow';

export interface ClientTableProps {
  clients: Client[];
}

export function ClientTable({ clients }: ClientTableProps) {
  return (
    <div className="card overflow-hidden p-0">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Cliente</th>
            <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Contacto</th>
            <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Última visita</th>
            <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Reservas</th>
            <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Interés</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <ClientRow key={client.id} client={client} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
