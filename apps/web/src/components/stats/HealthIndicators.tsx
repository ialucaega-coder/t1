'use client';

import { useState, useEffect } from 'react';
import { ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react';
import { statsApi } from '@/lib/api/index';
import type { HealthIndicator } from '@/lib/api/stats';

export function HealthIndicators() {
  const [indicators, setIndicators] = useState<HealthIndicator[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    statsApi
      .getHealthIndicators()
      .then((res) => setIndicators(res.indicators))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <h3 className="font-semibold text-white mb-1">Salud de la operación</h3>
      <p className="mono-label mb-4">INDICADORES CLAVE</p>
      {loading ? (
        <div className="flex items-center justify-center py-6 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          <span className="text-sm">Calculando...</span>
        </div>
      ) : failed ? (
        <p role="alert" className="text-sm text-red-400 py-2">
          No se pudieron calcular los indicadores. Recargá la página para reintentar.
        </p>
      ) : (
        <div className="space-y-4">
          {indicators.map((item) => {
            const changeAbs = Math.abs(item.change);
            const showChange = changeAbs >= 0.1;
            const isInverse = item.key === 'no_show_rate' || item.key === 'cancellation_rate';
            const changePositive = isInverse ? item.change < 0 : item.change > 0;
            return (
              <div key={item.key} className="flex items-center justify-between">
                <span className="text-sm text-slate-400">{item.label}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${item.good ? 'text-emerald-400' : 'text-yellow-400'}`}>
                    {item.value}
                  </span>
                  {showChange && (
                    <span className={`text-[10px] flex items-center gap-0.5 ${changePositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {changePositive ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                      {changeAbs.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
