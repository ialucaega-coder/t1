import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { summarizePendingParams, maskPhone, maskEmail, sanitizeText, lastStepIssue } from '@/components/mrgo/pending-summary';
import { PendingParams } from '@/components/mrgo/PendingParams';
import { CommandPanel } from '@/components/mrgo/CommandPanel';

describe('pending-summary', () => {
  it('enmascara el teléfono parcialmente y el email', () => {
    expect(maskPhone('+5491155551234')).toBe('+54•••••234');
    expect(maskPhone('1155551234')).toBe('11•••••234');
    expect(maskPhone('123')).toBe('••••');
    expect(maskEmail('ana@dominio.com')).toBe('a••@dominio.com');
  });

  it('resume solo campos conocidos: destinatario, mensaje, monto, campaña', () => {
    const rows = summarizePendingParams({
      to: '+5491155551234',
      message: 'Hola',
      amount: 2500,
      currency: 'ars',
      campaignName: 'Verano',
      apiKey: 'secreto',
      internal: { x: 1 },
    });
    expect(rows).toEqual([
      { label: 'Destinatario', value: '+54•••••234' },
      { label: 'Mensaje', value: 'Hola' },
      { label: 'Monto', value: '$ 2.500 ARS' },
      { label: 'Campaña', value: 'Verano' },
    ]);
  });

  it('sanea el texto: sin caracteres de control y recortado', () => {
    expect(sanitizeText('hola\u0000\n  mundo\t!')).toBe('hola mundo !');
    expect(sanitizeText('x'.repeat(500), 20)).toHaveLength(20);
    expect(sanitizeText({})).toBe('');
  });

  it('params vacíos o inválidos no rompen', () => {
    expect(summarizePendingParams(undefined)).toEqual([]);
    expect(summarizePendingParams(null)).toEqual([]);
    expect(summarizePendingParams({})).toEqual([]);
  });

  it('PendingParams renderiza el texto como texto (no interpreta HTML) y avisa si no hay datos', () => {
    const { container, rerender } = render(<PendingParams params={{ message: '<img src=x onerror=alert(1)>' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    rerender(<PendingParams params={{}} />);
    expect(screen.getByText('El agente no indicó datos para esta acción.')).toBeInTheDocument();
  });

  it('CommandPanel muestra los datos de la acción pendiente', () => {
    render(
      <CommandPanel
        agent={{ key: 'ceo', nombre: 'Mr Go', rol: 'CEO', color: 'LILA' }}
        pending={{ tool: 'enviar_whatsapp', kind: 'externo', params: { to: '+5491155551234', message: 'Hola Ana' } }}
        toolLabel={(k) => k}
      />,
    );
    expect(screen.getByText('Hola Ana')).toBeInTheDocument();
    expect(screen.getByText('+54•••••234')).toBeInTheDocument();
  });

  describe('lastStepIssue', () => {
    const step = (status: string, ok: boolean, detail = 'motivo') => [
      { tool: 'enviar_whatsapp', params: {}, result: { action: 'enviar_whatsapp', kind: 'externo' as const, ok, status: status as never, detail } },
    ];
    const name = () => 'Enviar WhatsApp';

    it('error → error; omitido/no_soportado/simulado → warning; ejecutado → null', () => {
      expect(lastStepIssue(step('error', false), name)).toEqual({ level: 'error', message: 'No se pudo ejecutar Enviar WhatsApp: motivo' });
      expect(lastStepIssue(step('omitido', false), name)?.level).toBe('warning');
      expect(lastStepIssue(step('no_soportado', false), name)?.level).toBe('warning');
      expect(lastStepIssue(step('simulado', true), name)?.message).toContain('solo se simuló');
      expect(lastStepIssue(step('ejecutado', true), name)).toBeNull();
      expect(lastStepIssue([], name)).toBeNull();
      expect(lastStepIssue(undefined, name)).toBeNull();
    });
  });
});
