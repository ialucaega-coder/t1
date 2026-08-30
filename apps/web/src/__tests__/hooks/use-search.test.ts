/**
 * Pruebas unitarias para el hook `useSearch` (`src/hooks/use-search.ts`).
 */
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSearch } from '@/hooks/use-search';

interface Item {
  id: number;
  name: string;
}

const items: Item[] = [
  { id: 1, name: 'Corte de pelo' },
  { id: 2, name: 'Manicura' },
  { id: 3, name: 'Corte de barba' },
];

const searchFn = (item: Item, query: string) =>
  item.name.toLowerCase().includes(query.toLowerCase());

describe('hooks/use-search', () => {
  it('devuelve todos los items cuando la query esta vacia', () => {
    const { result } = renderHook(() => useSearch(items, searchFn));

    expect(result.current.filtered).toEqual(items);
    expect(result.current.isFiltering).toBe(false);
  });

  it('filtra los items segun la funcion de busqueda', () => {
    const { result } = renderHook(() => useSearch(items, searchFn));

    act(() => {
      result.current.setQuery('corte');
    });

    expect(result.current.filtered).toHaveLength(2);
    expect(result.current.filtered.map(i => i.id)).toEqual([1, 3]);
    expect(result.current.isFiltering).toBe(true);
  });

  it('devuelve una lista vacia cuando ningun item coincide', () => {
    const { result } = renderHook(() => useSearch(items, searchFn));

    act(() => {
      result.current.setQuery('inexistente');
    });

    expect(result.current.filtered).toEqual([]);
  });

  it('vuelve a mostrar todos los items al limpiar la query', () => {
    const { result } = renderHook(() => useSearch(items, searchFn));

    act(() => {
      result.current.setQuery('manicura');
    });
    expect(result.current.filtered).toHaveLength(1);

    act(() => {
      result.current.setQuery('');
    });
    expect(result.current.filtered).toEqual(items);
    expect(result.current.isFiltering).toBe(false);
  });
});
