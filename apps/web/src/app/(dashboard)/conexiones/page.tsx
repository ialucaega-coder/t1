import { MessageCircle, Send, Globe, Instagram, Facebook, Calendar as CalendarIcon, Mail, CreditCard, Link2 } from 'lucide-react';

const channels = [
  { name: 'WhatsApp', icon: MessageCircle, status: 'connected', color: 'text-green-400' },
  { name: 'Telegram', icon: Send, status: 'disconnected', color: 'text-blue-400' },
  { name: 'Web Chat', icon: Globe, status: 'connected', color: 'text-brand-400' },
  { name: 'Instagram', icon: Instagram, status: 'disconnected', color: 'text-pink-400' },
  { name: 'Messenger', icon: Facebook, status: 'disconnected', color: 'text-blue-500' },
];

const integrations = [
  { name: 'Google Calendar', category: 'Agenda', icon: CalendarIcon, status: 'available' },
  { name: 'Cal.com', category: 'Agenda', icon: CalendarIcon, status: 'available' },
  { name: 'Calendly', category: 'Agenda', icon: CalendarIcon, status: 'available' },
  { name: 'Stripe', category: 'Pagos', icon: CreditCard, status: 'available' },
  { name: 'MercadoPago', category: 'Pagos', icon: CreditCard, status: 'available' },
  { name: 'Clip.mx', category: 'Pagos', icon: CreditCard, status: 'available' },
  { name: 'Mailchimp', category: 'Email', icon: Mail, status: 'available' },
  { name: 'SendGrid', category: 'Email', icon: Mail, status: 'available' },
  { name: 'HubSpot', category: 'CRM', icon: Link2, status: 'available' },
  { name: 'Notion', category: 'Productividad', icon: Link2, status: 'available' },
  { name: 'Google Sheets', category: 'Productividad', icon: Link2, status: 'available' },
  { name: 'Zapier', category: 'Automatización', icon: Link2, status: 'available' },
  { name: 'Make', category: 'Automatización', icon: Link2, status: 'available' },
  { name: 'n8n', category: 'Automatización', icon: Link2, status: 'available' },
  { name: 'Composio', category: 'Automatización', icon: Link2, status: 'available' },
];

export default function ConexionesPage() {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-slate-400 mb-6 max-w-2xl">
          Conecta tus canales de comunicación y herramientas favoritas. Cada canal es una puerta de
          entrada para tus clientes — cada integración, un puente con tus herramientas.
        </p>

        <h3 className="mono-label mb-4">CANALES DE COMUNICACIÓN</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {channels.map((channel) => {
            const Icon = channel.icon;
            return (
              <div key={channel.name} className="card-accent text-center">
                <Icon className={`h-8 w-8 ${channel.color} mx-auto mb-3`} />
                <h4 className="font-medium text-white mb-2">{channel.name}</h4>
                {channel.status === 'connected' ? (
                  <span className="badge-active">Conectado</span>
                ) : (
                  <button className="btn-secondary text-xs py-1 px-3">Conectar</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mono-label mb-4">INTEGRACIONES</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {integrations.map((integration) => {
            const Icon = integration.icon;
            return (
              <div key={integration.name} className="card flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-100">
                  <Icon className="h-5 w-5 text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{integration.name}</p>
                  <p className="text-[10px] font-mono text-slate-500 uppercase">{integration.category}</p>
                </div>
                <button className="btn-secondary text-xs py-1 px-2">
                  Conectar
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
