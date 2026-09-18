// ─── Email Templates ────────────────────────────────────────────────
// Plantillas HTML para emails transaccionales de Local B.
// Diseñadas con inline CSS para máxima compatibilidad con clientes de correo.

const BRAND_COLOR = '#38BDF8';
const DARK_BG = '#1E293B';
const LIGHT_BG = '#F8FAFC';
const TEXT_COLOR = '#334155';
const MUTED_COLOR = '#64748B';

// ─── Layout base ────────────────────────────────────────────────────

function baseLayout(content: string, preheader: string = ''): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Local B</title>
</head>
<body style="margin:0;padding:0;background-color:${LIGHT_BG};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${LIGHT_BG};">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color:${DARK_BG};padding:24px 32px;text-align:center;">
              <h1 style="margin:0;font-size:28px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;">
                Local <span style="color:${BRAND_COLOR};">B</span>
              </h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;color:${TEXT_COLOR};font-size:16px;line-height:1.6;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;background-color:${LIGHT_BG};text-align:center;border-top:1px solid #E2E8F0;">
              <p style="margin:0 0 8px;font-size:13px;color:${MUTED_COLOR};">
                Este email fue enviado por Local B.
              </p>
              <p style="margin:0;font-size:12px;color:${MUTED_COLOR};">
                Si no esperabas este mensaje, podés ignorarlo.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function infoRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 12px;font-size:14px;color:${MUTED_COLOR};border-bottom:1px solid #F1F5F9;">${label}</td>
    <td style="padding:8px 12px;font-size:14px;font-weight:600;color:${TEXT_COLOR};border-bottom:1px solid #F1F5F9;">${value}</td>
  </tr>`;
}

function detailTable(rows: Array<{ label: string; value: string }>): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
    ${rows.map((r) => infoRow(r.label, r.value)).join('')}
  </table>`;
}

// ─── Tipos de datos para templates ──────────────────────────────────

export interface BookingEmailData {
  clientName: string;
  serviceName: string;
  professionalName?: string;
  date: string;
  time: string;
  businessName?: string;
}

export interface OrderEmailData {
  clientName: string;
  orderId: string;
  status: string;
  totalPrice: string;
  businessName?: string;
}

export interface InvoiceEmailData {
  clientName: string;
  invoiceNumber: string;
  amount: string;
  date: string;
  description?: string;
  businessName?: string;
}

// ─── Templates ──────────────────────────────────────────────────────

export function bookingConfirmationTemplate(data: BookingEmailData): string {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Servicio', value: data.serviceName },
    { label: 'Fecha', value: data.date },
    { label: 'Hora', value: data.time },
  ];
  if (data.professionalName) {
    rows.push({ label: 'Profesional', value: data.professionalName });
  }

  const content = `
    <h2 style="margin:0 0 16px;font-size:22px;color:${DARK_BG};">¡Reserva confirmada!</h2>
    <p style="margin:0 0 16px;">Hola <strong>${data.clientName}</strong>, tu reserva ha sido confirmada con éxito.</p>
    ${detailTable(rows)}
    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};">
      Si necesitás modificar o cancelar tu reserva, ingresá a tu cuenta en Local B.
    </p>`;

  return baseLayout(content, `Tu reserva de ${data.serviceName} fue confirmada`);
}

export function bookingReminderTemplate(data: BookingEmailData): string {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Servicio', value: data.serviceName },
    { label: 'Fecha', value: data.date },
    { label: 'Hora', value: data.time },
  ];
  if (data.professionalName) {
    rows.push({ label: 'Profesional', value: data.professionalName });
  }

  const content = `
    <h2 style="margin:0 0 16px;font-size:22px;color:${DARK_BG};">Recordatorio de tu cita</h2>
    <p style="margin:0 0 16px;">Hola <strong>${data.clientName}</strong>, te recordamos que tenés una cita programada.</p>
    ${detailTable(rows)}
    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};">
      ¡Te esperamos! Si no podés asistir, por favor cancelá con anticipación.
    </p>`;

  return baseLayout(content, `Recordatorio: tu cita de ${data.serviceName} es pronto`);
}

export function orderStatusTemplate(data: OrderEmailData): string {
  const statusEmoji: Record<string, string> = {
    pendiente: '⏳',
    confirmado: '✅',
    'en preparación': '👨‍🍳',
    'listo para retirar': '📦',
    entregado: '🚚',
    cancelado: '❌',
  };

  const emoji = statusEmoji[data.status] ?? '🔔';

  const content = `
    <h2 style="margin:0 0 16px;font-size:22px;color:${DARK_BG};">Actualización de pedido</h2>
    <p style="margin:0 0 16px;">Hola <strong>${data.clientName}</strong>, tu pedido cambió de estado.</p>
    ${detailTable([
      { label: 'Pedido', value: `#${data.orderId.slice(-6).toUpperCase()}` },
      { label: 'Estado', value: `${emoji} ${data.status.charAt(0).toUpperCase() + data.status.slice(1)}` },
      { label: 'Total', value: data.totalPrice },
    ])}
    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};">
      Podés ver el detalle completo de tu pedido ingresando a tu cuenta.
    </p>`;

  return baseLayout(content, `Tu pedido ahora está ${data.status}`);
}

export function welcomeTemplate(userName: string, businessName: string): string {
  const content = `
    <h2 style="margin:0 0 16px;font-size:22px;color:${DARK_BG};">¡Bienvenido/a a Local B!</h2>
    <p style="margin:0 0 16px;">Hola <strong>${userName}</strong>, tu cuenta fue creada exitosamente${businessName ? ` en <strong>${businessName}</strong>` : ''}.</p>
    <p style="margin:0 0 24px;">Ahora podés:</p>
    <ul style="margin:0 0 24px;padding-left:20px;color:${TEXT_COLOR};">
      <li style="margin-bottom:8px;">Reservar turnos y servicios</li>
      <li style="margin-bottom:8px;">Hacer pedidos online</li>
      <li style="margin-bottom:8px;">Recibir notificaciones y recordatorios</li>
    </ul>
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
      <tr>
        <td style="background-color:${BRAND_COLOR};border-radius:8px;text-align:center;">
          <a href="#" style="display:inline-block;padding:12px 32px;color:#FFFFFF;font-size:16px;font-weight:600;text-decoration:none;">
            Comenzar
          </a>
        </td>
      </tr>
    </table>`;

  return baseLayout(content, `Bienvenido/a a ${businessName || 'Local B'}`);
}

export function invoiceTemplate(data: InvoiceEmailData): string {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Comprobante', value: data.invoiceNumber },
    { label: 'Fecha', value: data.date },
    { label: 'Monto', value: data.amount },
  ];
  if (data.description) {
    rows.push({ label: 'Concepto', value: data.description });
  }

  const content = `
    <h2 style="margin:0 0 16px;font-size:22px;color:${DARK_BG};">Comprobante de pago</h2>
    <p style="margin:0 0 16px;">Hola <strong>${data.clientName}</strong>, tu pago fue procesado correctamente.</p>
    ${detailTable(rows)}
    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};">
      Conservá este email como comprobante. Podés ver el historial de pagos en tu cuenta.
    </p>`;

  return baseLayout(content, `Comprobante de pago - ${data.amount}`);
}

export function genericNotificationTemplate(title: string, htmlContent: string): string {
  const content = `
    <h2 style="margin:0 0 16px;font-size:22px;color:${DARK_BG};">${title}</h2>
    <div style="margin:0;">${htmlContent}</div>`;

  return baseLayout(content, title);
}
