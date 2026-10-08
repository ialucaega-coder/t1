'use client';

import { useEffect } from 'react';
import { create } from 'zustand';

// Store global del "contador" que muestra el Header al lado del título de la
// página (p. ej. "1 BOT", "8 HABILIDADES"). Antes era un string HARDCODEADO en
// config/page-titles.ts que nunca reflejaba datos reales; ahora cada página
// empuja su conteo real (derivado de sus hooks de API) y el Header lo lee.
type PageCounterState = {
  counter: string | null;
  setCounter: (c: string | null) => void;
};

export const usePageCounterStore = create<PageCounterState>((set) => ({
  counter: null,
  setCounter: (counter) => set({ counter }),
}));

// Helper para páginas: setea el contador del Header mientras la página está
// montada y lo limpia al desmontar (evita que quede el valor de la página
// anterior durante la navegación). Pasar `null` mientras carga para no mostrar
// un número viejo/incorrecto.
export function usePageCounter(value: string | null) {
  const setCounter = usePageCounterStore((s) => s.setCounter);
  useEffect(() => {
    setCounter(value);
    return () => setCounter(null);
  }, [value, setCounter]);
}

// Formatea "n ETIQUETA" con singular/plural simple. Devuelve null si n no es un
// número válido (así el Header no muestra badge hasta que haya dato real).
export function fmtCounter(
  n: number | null | undefined,
  singular: string,
  plural: string,
): string | null {
  if (typeof n !== 'number' || Number.isNaN(n)) return null;
  return `${n} ${n === 1 ? singular : plural}`;
}
