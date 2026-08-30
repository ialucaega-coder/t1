export interface AgencyClient {
  id: string;
  name: string;
  plan: 'Free' | 'Local B+';
  bots: number;
  status: 'active' | 'trial' | 'inactive';
  revenue: string;
  lastActivity: string;
}

export const MOCK_AGENCY_CLIENTS: AgencyClient[] = [
  { id: '1', name: 'Barbería Don Carlos', plan: 'Local B+', bots: 3, status: 'active', revenue: '$2,500/mes', lastActivity: 'Hace 2 horas' },
  { id: '2', name: 'Spa Relax', plan: 'Free', bots: 1, status: 'active', revenue: '$1,200/mes', lastActivity: 'Hace 1 día' },
  { id: '3', name: 'Studio Ana', plan: 'Local B+', bots: 2, status: 'active', revenue: '$3,100/mes', lastActivity: 'Hace 3 horas' },
  { id: '4', name: 'Clínica Dental Sonrisa', plan: 'Local B+', bots: 4, status: 'active', revenue: '$4,500/mes', lastActivity: 'Hace 30 min' },
  { id: '5', name: 'Gym Fitness Pro', plan: 'Free', bots: 1, status: 'trial', revenue: '$0', lastActivity: 'Hace 5 días' },
  { id: '6', name: 'Restaurante El Buen Sabor', plan: 'Local B+', bots: 2, status: 'active', revenue: '$2,800/mes', lastActivity: 'Hace 1 hora' },
];

export const AGENCY_STATS = {
  totalBusinesses: 6,
  totalBots: 13,
  totalRevenue: '$14,100/mes',
  activeClients: 5,
  referralCode: 'AGENCIA-LB-2024',
  referralLink: 'https://localb.app/ref/AGENCIA-LB-2024',
  commission: '20%',
};
