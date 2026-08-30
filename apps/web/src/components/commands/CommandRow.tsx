import { Copy, Check } from 'lucide-react';

export interface CommandRowProps {
  name: string;
  desc: string;
  isCopied: boolean;
  onCopy: () => void;
}

export function CommandRow({ name, desc, isCopied, onCopy }: CommandRowProps) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-slate-800 bg-surface-50 px-4 py-3 hover:border-slate-700 transition-colors">
      <code className="font-mono text-sm text-brand-400 min-w-[180px]">{name}</code>
      <p className="text-sm text-slate-400 flex-1">{desc}</p>
      <button
        onClick={onCopy}
        className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-surface-100 hover:text-white transition-colors"
      >
        {isCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
