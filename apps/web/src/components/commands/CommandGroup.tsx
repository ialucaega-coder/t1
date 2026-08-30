import { type CommandGroup as CommandGroupType } from '@/constants/commands';
import { CommandRow } from './CommandRow';

export interface CommandGroupProps {
  group: CommandGroupType;
  copiedCmd: string | null;
  onCopy: (cmd: string) => void;
}

export function CommandGroup({ group, copiedCmd, onCopy }: CommandGroupProps) {
  return (
    <div>
      <h3 className="mono-label mb-3">{group.category}</h3>
      <div className="space-y-1">
        {group.items.map((cmd) => (
          <CommandRow
            key={cmd.name}
            name={cmd.name}
            desc={cmd.desc}
            isCopied={copiedCmd === cmd.name}
            onCopy={() => onCopy(cmd.name)}
          />
        ))}
      </div>
    </div>
  );
}
