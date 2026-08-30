import { Calendar, MessageCircle } from 'lucide-react';
import { type Client, CLIENT_STATUS_CONFIG as statusConfig } from '@/constants/clients';

export interface ClientRowProps {
  client: Client;
}

export function ClientRow({ client }: ClientRowProps) {
  return (
    <tr className="border-b border-slate-800/50 hover:bg-surface-100 transition-colors cursor-pointer">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/20 text-brand-400 text-xs font-bold">
            {client.name.split(' ').map(n => n[0]).join('')}
          </div>
          <span className="text-sm font-medium text-white">{client.name}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <p className="text-xs text-slate-400">{client.email}</p>
        <p className="text-xs text-slate-500">{client.phone}</p>
      </td>
      <td className="px-4 py-3 text-xs text-slate-400">{client.lastVisit}</td>
      <td className="px-4 py-3 text-sm font-medium text-white">{client.totalBookings}</td>
      <td className="px-4 py-3">
        <span className={`badge border ${statusConfig[client.status].class}`}>
          {statusConfig[client.status].label}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <button className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-surface-100">
            <MessageCircle className="h-3.5 w-3.5" />
          </button>
          <button className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-surface-100">
            <Calendar className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
