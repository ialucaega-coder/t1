import { InlineKeyboard } from 'grammy';

// ────────────────────────────────────────────────────────────────
// Constructores de teclados inline para el bot de Telegram.
// Cada función devuelve un InlineKeyboard listo para pasar en
// reply_markup al enviar un mensaje.
// ────────────────────────────────────────────────────────────────

/** Menú principal después de /start */
export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📅 Reservar turno', 'action:reservar')
    .row()
    .text('📋 Ver servicios', 'action:servicios')
    .row()
    .text('🕐 Horarios disponibles', 'action:horarios')
    .row()
    .text('❌ Cancelar reserva', 'action:cancelar')
    .row()
    .text('❓ Ayuda', 'action:ayuda');
}

/** Lista de servicios activos como botones */
export function servicesKeyboard(
  services: { id: string; name: string; price: number | string; duration: number }[],
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const s of services) {
    kb.text(`${s.name} — $${s.price} (${s.duration} min)`, `service:${s.id}`).row();
  }
  kb.text('« Volver al menú', 'action:menu');
  return kb;
}

/** Selector de profesional */
export function professionalsKeyboard(
  professionals: { id: string; name: string }[],
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const p of professionals) {
    kb.text(p.name, `professional:${p.id}`).row();
  }
  kb.text('« Volver al menú', 'action:menu');
  return kb;
}

/** Selector de fecha (próximos 7 días) */
export function dateKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const now = new Date();

  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const label = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : `${dias[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
    const value = d.toISOString().split('T')[0]; // YYYY-MM-DD
    kb.text(label, `date:${value}`).row();
  }

  kb.text('« Volver al menú', 'action:menu');
  return kb;
}

/** Selector de horarios disponibles */
export function timeSlotsKeyboard(slots: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  // Mostrar hasta 3 slots por fila
  for (let i = 0; i < slots.length; i += 3) {
    const row = slots.slice(i, i + 3);
    for (const slot of row) {
      kb.text(slot, `time:${slot}`);
    }
    kb.row();
  }
  kb.text('« Volver al menú', 'action:menu');
  return kb;
}

/** Confirmación de reserva */
export function confirmationKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Confirmar reserva', 'confirm:yes')
    .text('❌ Cancelar', 'confirm:no');
}

/** Lista de reservas del usuario para cancelar */
export function bookingsKeyboard(
  bookings: { id: string; serviceName: string; date: string; startTime: string }[],
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const b of bookings) {
    kb.text(`${b.serviceName} — ${b.date} ${b.startTime}`, `cancel:${b.id}`).row();
  }
  kb.text('« Volver al menú', 'action:menu');
  return kb;
}
