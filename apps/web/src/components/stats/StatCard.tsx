import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { type StatCard as StatCardType } from '@/constants/stats';

export interface StatCardProps {
  stat: StatCardType;
}

export function StatCard({ stat }: StatCardProps) {
  const Icon = stat.icon;
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <Icon className="h-5 w-5 text-brand-400" />
        <div className={`flex items-center gap-1 text-xs font-medium ${
          stat.trend === 'up' ? 'text-emerald-400' : 'text-red-400'
        }`}>
          {stat.trend === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {stat.change}
        </div>
      </div>
      <p className="text-2xl font-bold text-white">{stat.value}</p>
      <p className="text-xs text-slate-500 mt-1">{stat.label}</p>
    </div>
  );
}
