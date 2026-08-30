import { MessageCircle } from 'lucide-react';

const templates = [
  { name: 'Recordatorio de cita', type: 'UTILITY', desc: 'Avisa a tu cliente antes de su cita para bajar los no-shows.', providers: ['CLOUD API', 'TWILIO'] },
  { name: 'Reenganche de lead frío / no-show', type: 'MARKETING', desc: 'Retoma contacto con un lead que se enfrió o no llegó a su cita, fuera de las 24h.', providers: [], premium: true },
  { name: 'Confirmación de pedido', type: 'UTILITY', desc: 'Confirma que el pedido/orden fue recibido, con folio y detalle.', providers: ['CLOUD API', 'TWILIO'] },
  { name: 'Promoción / oferta', type: 'MARKETING', desc: 'Avisa de una promo o descuento vigente a tu base de clientes.', providers: ['CLOUD API', 'TWILIO'] },
  { name: 'Post-venta / pedir reseña', type: 'UTILITY', desc: 'Da seguimiento después de la compra e invita a dejar una reseña.', providers: ['CLOUD API', 'TWILIO'] },
  { name: 'Aviso de cobro / pago pendiente', type: 'UTILITY', desc: 'Notifica un cobro generado o un pago pendiente con su link.', providers: [], premium: true },
];

export default function PlantillasPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        Para escribirle primero a un cliente por WhatsApp (fuera de la ventana de 24h), Meta exige una
        <strong className="text-white"> plantilla (HSM) aprobada</strong>. Elige el prompt según cómo conectaste
        WhatsApp — <span className="text-brand-400">Cloud API</span> (oficial de Meta) o{' '}
        <span className="text-brand-400">Twilio</span>.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((template) => (
          <div key={template.name} className="card-accent">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-semibold text-white">{template.name}</h3>
              <span className={`badge border text-[9px] ${
                template.type === 'UTILITY'
                  ? 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                  : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
              }`}>
                {template.type}
              </span>
            </div>
            <p className="text-sm text-slate-400 mb-4">{template.desc}</p>
            {template.premium ? (
              <button className="btn-primary text-xs py-1.5">
                ✦ Actualizar a Local B+
              </button>
            ) : (
              <div className="flex gap-2">
                {template.providers.map((provider) => (
                  <button key={provider} className="btn-secondary text-xs py-1.5 px-3 flex-1">
                    {'>'} {provider}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
