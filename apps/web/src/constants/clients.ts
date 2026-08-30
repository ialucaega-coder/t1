export type ClientStatus = 'hot' | 'warm' | 'cold';

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  lastVisit: string;
  totalBookings: number;
  status: ClientStatus;
}

export interface ClientStatusConfigEntry {
  label: string;
  class: string;
}

export const MOCK_CLIENTS: Client[] = [
  { id: '1', name: 'María García', email: 'maria@email.com', phone: '+54 11 5555-0001', lastVisit: '2024-01-15', totalBookings: 12, status: 'hot' },
  { id: '2', name: 'Juan Pérez', email: 'juan@email.com', phone: '+54 11 5555-0002', lastVisit: '2024-01-10', totalBookings: 8, status: 'warm' },
  { id: '3', name: 'Laura Méndez', email: 'laura@email.com', phone: '+54 11 5555-0003', lastVisit: '2024-01-18', totalBookings: 23, status: 'hot' },
  { id: '4', name: 'Roberto Silva', email: 'roberto@email.com', phone: '+54 11 5555-0004', lastVisit: '2023-12-20', totalBookings: 3, status: 'cold' },
  { id: '5', name: 'Ana Torres', email: 'ana@email.com', phone: '+54 11 5555-0005', lastVisit: '2024-01-16', totalBookings: 15, status: 'hot' },
];

export const CLIENT_STATUS_CONFIG: Record<ClientStatus, ClientStatusConfigEntry> = {
  hot: { label: 'Caliente', class: 'bg-red-500/10 text-red-400 border-red-500/20' },
  warm: { label: 'Tibio', class: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  cold: { label: 'Frío', class: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
};
