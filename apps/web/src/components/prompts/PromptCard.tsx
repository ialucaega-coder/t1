import { Copy, Check, Pencil, Trash2 } from 'lucide-react';
import { type Prompt } from '@/constants/prompts';

export interface PromptCardProps {
  prompt: Prompt;
  isCopied: boolean;
  onCopy: () => void;
}

export function PromptCard({ prompt, isCopied, onCopy }: PromptCardProps) {
  return (
    <div className="card-accent flex flex-col">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-semibold text-white">{prompt.name}</h3>
          <p className="mono-label">{prompt.category}</p>
        </div>
        {prompt.isActive ? (
          <span className="badge-active">ACTIVO</span>
        ) : (
          <span className="badge text-slate-500 border border-slate-700">INACTIVO</span>
        )}
      </div>
      <pre className="flex-1 text-xs text-slate-400 bg-surface rounded-lg p-3 mt-2 mb-3 whitespace-pre-wrap font-mono overflow-hidden max-h-32">
        {prompt.content}
      </pre>
      <div className="flex items-center gap-2">
        <button
          onClick={onCopy}
          className="btn-secondary text-xs py-1 px-2 flex-1"
        >
          {isCopied ? (
            <><Check className="h-3 w-3 text-emerald-400" /> Copiado</>
          ) : (
            <><Copy className="h-3 w-3" /> Copiar prompt</>
          )}
        </button>
        <button className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-surface-100">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-surface-100">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
