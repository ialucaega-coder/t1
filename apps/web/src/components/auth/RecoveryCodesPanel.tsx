'use client';

import { useState } from 'react';
import { Copy, Download, KeyRound, TriangleAlert } from 'lucide-react';

interface RecoveryCodesPanelProps {
  codes: string[];
  /** Se llama cuando la persona confirma que guardó los códigos. */
  onDone: () => void;
}

/**
 * Muestra los códigos de recuperación del 2FA UNA sola vez. El server solo
 * guarda sus hashes, así que si se cierra esto sin guardarlos no hay forma de
 * volver a verlos (solo generar un juego nuevo). Por eso "Listo" queda bloqueado
 * hasta que la persona confirma que los guardó.
 */
export function RecoveryCodesPanel({ codes, onDone }: RecoveryCodesPanelProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const text = codes.join('\n');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sin permiso de portapapeles: la persona puede seleccionar el texto a mano */
    }
  }

  function handleDownload() {
    const body =
      'Códigos de recuperación — Mr. Go Assistance\n' +
      'Cada código se puede usar UNA sola vez en lugar del código de tu app.\n\n' +
      `${text}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'codigos-de-recuperacion.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4" role="group" aria-label="Códigos de recuperación">
      <div className="flex items-start gap-2">
        <TriangleAlert className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-200">
          Guardá estos códigos en un lugar seguro. Si perdés tu celular, son la única forma de entrar. Cada uno
          sirve una sola vez y <strong>no se vuelven a mostrar</strong>.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {codes.map((code) => (
          <li
            key={code}
            className="rounded-md border border-slate-700/50 bg-slate-800/50 px-2 py-1.5 text-center font-mono text-xs text-slate-200 select-all"
          >
            {code}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={handleCopy} className="btn-secondary text-xs">
          <Copy className="h-3.5 w-3.5" /> {copied ? 'Copiados' : 'Copiar'}
        </button>
        <button type="button" onClick={handleDownload} className="btn-secondary text-xs">
          <Download className="h-3.5 w-3.5" /> Descargar .txt
        </button>
      </div>

      <label htmlFor="recovery-codes-saved" className="flex items-center gap-2 text-xs text-slate-300">
        <input
          id="recovery-codes-saved"
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        Ya guardé mis códigos de recuperación
      </label>

      <button type="button" onClick={onDone} disabled={!saved} className="btn-primary text-xs disabled:opacity-40">
        <KeyRound className="h-3.5 w-3.5" /> Listo
      </button>
    </div>
  );
}
