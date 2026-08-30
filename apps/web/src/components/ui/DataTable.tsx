import { cn } from '@/lib/utils';

export interface DataTableColumn {
  key: string;
  label: string;
  className?: string;
}

export interface DataTableProps {
  columns: DataTableColumn[];
  children: React.ReactNode;
  className?: string;
}

export function DataTable({ columns, children, className }: DataTableProps) {
  return (
    <div className={cn('card overflow-hidden p-0', className)}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-800">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  'text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500',
                  column.className
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
