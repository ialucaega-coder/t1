/** Etiquetas en español de los estados de suscripción (enum SubscriptionStatus del server). */
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activa',
  PAST_DUE: 'Pago pendiente',
  TRIALING: 'En prueba',
  CANCELLED: 'Cancelada',
};

/** Texto del estado; un estado desconocido se muestra tal cual en vez de decir "Cancelada". */
export function subscriptionStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Clases del badge según el estado. */
export function subscriptionStatusClass(status: string): string {
  if (status === 'ACTIVE' || status === 'TRIALING') return 'bg-emerald-500/10 text-emerald-400';
  if (status === 'PAST_DUE') return 'bg-amber-500/10 text-amber-400';
  if (status === 'CANCELLED') return 'bg-red-500/10 text-red-400';
  return 'bg-slate-500/10 text-slate-300';
}

/**
 * true si hay una suscripción vigente (cualquier estado menos CANCELLED). El server
 * responde 409 "usá el portal" en POST /billing/subscribe en ese caso, así que el
 * cambio de plan se hace desde el portal de facturación.
 */
export function hasLiveSubscription(sub: { status: string } | null | undefined): boolean {
  return !!sub && sub.status !== 'CANCELLED';
}
