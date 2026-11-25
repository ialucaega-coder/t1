/**
 * Respaldo entre proveedores de IA (`services/ai/failover.ts`): reintenta con el
 * siguiente proveedor al fallar, corta el circuito del caído y no ejecuta nada
 * extra (solo texto).
 */
import { describe, it, expect, vi } from 'vitest';
import { FailoverProvider, DOWN_MS } from '../../services/ai/failover';
import type { AIProvider } from '../../services/ai/provider';
import { fallbackSlots } from '../../services/ai/engine';
import { getEngineById } from '../../services/ai/catalog';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));

const ctx = { businessId: 'b1', history: [], systemPrompt: 's' };
const ok = (text: string): AIProvider => ({ name: 'x', generateResponse: vi.fn().mockResolvedValue(text) });
const bad = (): AIProvider => ({ name: 'x', generateResponse: vi.fn().mockRejectedValue(new Error('timeout')) });

describe('FailoverProvider', () => {
  it('usa el principal si anda y no arma los respaldos', async () => {
    const build = vi.fn(() => ok('B'));
    const p = new FailoverProvider(ok('A'), 'a', [{ label: 'b', build }]);
    expect(await p.generateResponse('hola', ctx)).toBe('A');
    expect(build).not.toHaveBeenCalled();
  });

  it('si el principal falla, responde el respaldo (una sola respuesta)', async () => {
    const backup = ok('B');
    const p = new FailoverProvider(bad(), 'a', [{ label: 'b', build: () => backup }]);
    expect(await p.generateResponse('hola', ctx)).toBe('B');
    expect(backup.generateResponse).toHaveBeenCalledTimes(1);
  });

  it('corta el circuito: el caído se saltea hasta pasar DOWN_MS', async () => {
    let t = 1_000;
    const primary = bad();
    const p = new FailoverProvider(primary, 'a', [{ label: 'b', build: () => ok('B') }], () => t);
    await p.generateResponse('1', ctx);
    await p.generateResponse('2', ctx);
    expect(primary.generateResponse).toHaveBeenCalledTimes(1);
    t += DOWN_MS + 1;
    await p.generateResponse('3', ctx);
    expect(primary.generateResponse).toHaveBeenCalledTimes(2);
  });

  it('si fallan todos, lanza el último error', async () => {
    const p = new FailoverProvider(bad(), 'a', [{ label: 'b', build: () => bad() }]);
    await expect(p.generateResponse('x', ctx)).rejects.toThrow('timeout');
  });

  it('con todos marcados caídos igual intenta el principal', async () => {
    let t = 1;
    const primary = bad();
    const p = new FailoverProvider(primary, 'a', [{ label: 'b', build: () => bad() }], () => t);
    await expect(p.generateResponse('1', ctx)).rejects.toThrow();
    await expect(p.generateResponse('2', ctx)).rejects.toThrow();
    expect(primary.generateResponse).toHaveBeenCalledTimes(2);
  });
});

describe('fallbackSlots', () => {
  it('elige otras familias con key disponible y respeta el máximo', () => {
    process.env.OPENAI_API_KEY = 'k1';
    process.env.ANTHROPIC_API_KEY = 'k2';
    const active = getEngineById('claude-sonnet')!;
    const slots = fallbackSlots(active, { activeEngineId: active.id, keys: {} });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(2);
    expect(slots.every((s) => !s.label.startsWith('anthropic:'))).toBe(true);
  });

  it('sin keys de otras familias no hay respaldo', () => {
    const saved = { ...process.env };
    for (const k of Object.keys(process.env)) if (/_API_KEY$/.test(k)) delete process.env[k];
    const active = getEngineById('claude-sonnet')!;
    expect(fallbackSlots(active, { activeEngineId: active.id, keys: {} })).toHaveLength(0);
    Object.assign(process.env, saved);
  });
});
