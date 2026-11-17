'use client';

import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';

/** true si el texto es una URL https válida (misma regla que el server). */
export function isHttpsImageUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

interface ImageUrlFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

/** Campo de imagen por URL con vista previa y aviso si la imagen no carga. */
export function ImageUrlField({ value, onChange, label = 'Imagen (URL https)' }: ImageUrlFieldProps) {
  const trimmed = value.trim();
  const valid = trimmed !== '' && isHttpsImageUrl(trimmed);
  const [loadFailed, setLoadFailed] = useState(false);

  // Cada URL nueva vuelve a intentar la carga.
  useEffect(() => { setLoadFailed(false); }, [trimmed]);

  return (
    <div>
      <label className="text-xs text-slate-500 mb-1 block">{label}</label>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
        placeholder="https://ejemplo.com/foto.jpg"
      />
      {trimmed !== '' && !valid && (
        <p className="mt-1 text-[11px] text-red-400">La imagen debe ser una URL que empiece con https://</p>
      )}
      {valid && !loadFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={trimmed}
          alt="Vista previa"
          onError={() => setLoadFailed(true)}
          referrerPolicy="no-referrer"
          className="mt-2 h-24 w-24 rounded-lg border border-slate-700 object-cover"
        />
      )}
      {valid && loadFailed && (
        <p role="alert" className="mt-2 flex items-center gap-1.5 text-[11px] text-yellow-400">
          <ImageOff className="h-3.5 w-3.5" /> No se pudo cargar la imagen. Revisá que la URL sea pública y apunte a una imagen.
        </p>
      )}
    </div>
  );
}
