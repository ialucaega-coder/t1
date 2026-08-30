export type WhatsappTemplateType = 'UTILITY' | 'MARKETING';

export interface WhatsappTemplate {
  name: string;
  type: WhatsappTemplateType;
  desc: string;
  providers: string[];
  premium?: boolean;
}

export const WHATSAPP_TEMPLATES: WhatsappTemplate[] = [
  { name: 'Recordatorio de cita', type: 'UTILITY', desc: 'Avisa a tu cliente antes de su cita para bajar los no-shows.', providers: ['CLOUD API', 'TWILIO'] },
  { name: 'Reenganche de lead frío / no-show', type: 'MARKETING', desc: 'Retoma contacto con un lead que se enfrió o no llegó a su cita, fuera de las 24h.', providers: ['CLOUD API', 'TWILIO'], premium: false },
  { name: 'Confirmación de pedido', type: 'UTILITY', desc: 'Confirma que el pedido/orden fue recibido, con folio y detalle.', providers: ['CLOUD API', 'TWILIO'] },
  { name: 'Promoción / oferta', type: 'MARKETING', desc: 'Avisa de una promo o descuento vigente a tu base de clientes.', providers: ['CLOUD API', 'TWILIO'] },
  { name: 'Post-venta / pedir reseña', type: 'UTILITY', desc: 'Da seguimiento después de la compra e invita a dejar una reseña.', providers: ['CLOUD API', 'TWILIO'] },
  { name: 'Aviso de cobro / pago pendiente', type: 'UTILITY', desc: 'Notifica un cobro generado o un pago pendiente con su link.', providers: ['CLOUD API', 'TWILIO'], premium: false },
];
