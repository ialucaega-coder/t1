/** Rótulos de satisfacción estimada y de costos con/sin rango elegido. */
import { describe, it, expect } from 'vitest';
import { SATISFACTION_LABEL, SATISFACTION_HELP, satisfactionLevelLabel, costLabels } from '@/lib/satisfaction';

describe('lib/satisfaction', () => {
  it('la satisfacción se rotula como estimada y explica de dónde sale', () => {
    expect(SATISFACTION_LABEL).toBe('Satisfacción estimada');
    expect(SATISFACTION_HELP).toBe(
      'Se estima según cómo terminan las conversaciones; todavía no se piden calificaciones a los clientes.',
    );
  });

  it('los niveles de la distribución no usan estrellas', () => {
    expect(satisfactionLevelLabel(4)).toBe('Nivel 4 de 5');
    expect(satisfactionLevelLabel(4)).not.toContain('★');
  });

  it('sin rango elegido conserva "mensual"', () => {
    expect(costLabels({ kind: 'default' })).toEqual({ cost: 'Costo IA mensual', budget: 'Presupuesto mensual' });
    expect(costLabels(undefined).cost).toBe('Costo IA mensual');
  });

  it('con un rango (preset o personalizado) dice "del período" y no "mensual"', () => {
    for (const r of [{ kind: 'preset', days: 7 } as const, { kind: 'custom', from: '2026-10-01', to: '2026-10-05' } as const]) {
      const l = costLabels(r);
      expect(l.cost).toBe('Costo IA del período');
      expect(`${l.cost} ${l.budget}`).not.toMatch(/mensual/i);
    }
  });
});
