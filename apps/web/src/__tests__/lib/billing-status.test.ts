import { describe, it, expect } from 'vitest';
import { hasLiveSubscription, subscriptionStatusClass, subscriptionStatusLabel } from '@/lib/billing-status';

describe('lib/billing-status', () => {
  it('traduce los estados del server y no inventa "Cancelada"', () => {
    expect(subscriptionStatusLabel('ACTIVE')).toBe('Activa');
    expect(subscriptionStatusLabel('PAST_DUE')).toBe('Pago pendiente');
    expect(subscriptionStatusLabel('TRIALING')).toBe('En prueba');
    expect(subscriptionStatusLabel('CANCELLED')).toBe('Cancelada');
    expect(subscriptionStatusLabel('ALGO_NUEVO')).toBe('ALGO_NUEVO');
  });

  it('suscripción vigente = cualquier estado menos CANCELLED', () => {
    expect(hasLiveSubscription({ status: 'ACTIVE' })).toBe(true);
    expect(hasLiveSubscription({ status: 'PAST_DUE' })).toBe(true);
    expect(hasLiveSubscription({ status: 'TRIALING' })).toBe(true);
    expect(hasLiveSubscription({ status: 'CANCELLED' })).toBe(false);
    expect(hasLiveSubscription(null)).toBe(false);
  });

  it('el color distingue cancelada de los demás', () => {
    expect(subscriptionStatusClass('CANCELLED')).toContain('red');
    expect(subscriptionStatusClass('TRIALING')).toContain('emerald');
    expect(subscriptionStatusClass('X')).not.toContain('red');
  });
});
