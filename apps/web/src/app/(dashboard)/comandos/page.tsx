'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { COMMANDS as commands } from '@/constants/commands';
import { useClipboard } from '@/hooks';
import { CommandRow } from '@/components/commands/CommandRow';
import { CommandGroup } from '@/components/commands/CommandGroup';

export default function ComandosPage() {
  const { copiedId: copiedCmd, copy } = useClipboard();
  const [search, setSearch] = useState('');

  const copyToClipboard = (cmd: string) => copy(cmd, cmd);

  const allCommands = commands.flatMap(c => c.items.map(i => ({ ...i, category: c.category })));
  const filtered = search
    ? allCommands.filter(c => c.name.includes(search) || c.desc.toLowerCase().includes(search.toLowerCase()))
    : null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        Comandos que puedes usar desde el chat de tu bot o copiar para tu agente.
        Haz click en el ícono para copiar.
      </p>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Buscar comando..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-10"
        />
      </div>

      {filtered ? (
        <div className="space-y-1">
          {filtered.map((cmd) => (
            <CommandRow
              key={cmd.name}
              name={cmd.name}
              desc={cmd.desc}
              isCopied={copiedCmd === cmd.name}
              onCopy={() => copyToClipboard(cmd.name)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-slate-500 py-8 text-center">No se encontraron comandos</p>
          )}
        </div>
      ) : (
        commands.map((group) => (
          <CommandGroup
            key={group.category}
            group={group}
            copiedCmd={copiedCmd}
            onCopy={copyToClipboard}
          />
        ))
      )}
    </div>
  );
}
