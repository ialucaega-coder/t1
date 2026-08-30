/**
 * Pruebas unitarias para el hook `useClipboard` (`src/hooks/use-clipboard.ts`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useClipboard } from '@/hooks/use-clipboard';

describe('hooks/use-clipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('inicia sin ningun elemento copiado', () => {
    const { result } = renderHook(() => useClipboard());

    expect(result.current.copiedId).toBeNull();
  });

  it('copia el texto al portapapeles y marca el id como copiado', () => {
    const { result } = renderHook(() => useClipboard());

    act(() => {
      result.current.copy('item-1', 'texto a copiar');
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('texto a copiar');
    expect(result.current.copiedId).toBe('item-1');
  });

  it('resetea copiedId a null despues del delay configurado', () => {
    const { result } = renderHook(() => useClipboard(2000));

    act(() => {
      result.current.copy('item-1', 'texto');
    });
    expect(result.current.copiedId).toBe('item-1');

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.copiedId).toBeNull();
  });

  it('respeta un resetDelay personalizado', () => {
    const { result } = renderHook(() => useClipboard(500));

    act(() => {
      result.current.copy('item-x', 'texto');
    });

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current.copiedId).toBe('item-x');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copiedId).toBeNull();
  });

  it('al copiar un segundo item reemplaza el copiedId anterior', () => {
    const { result } = renderHook(() => useClipboard());

    act(() => {
      result.current.copy('item-1', 'a');
    });
    act(() => {
      result.current.copy('item-2', 'b');
    });

    expect(result.current.copiedId).toBe('item-2');
  });
});
