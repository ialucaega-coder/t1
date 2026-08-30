const HEALTH_INDICATORS = [
  { label: 'Tasa de confirmación', value: '94%', good: true },
  { label: 'Tiempo promedio de respuesta', value: '2.3 min', good: true },
  { label: 'Satisfacción del cliente', value: '4.8/5', good: true },
  { label: 'Tasa de no-show', value: '3.2%', good: true },
  { label: 'Retencion mensual', value: '78%', good: false },
];

export function HealthIndicators() {
  return (
    <div className="card">
      <h3 className="font-semibold text-white mb-1">Salud de la operación</h3>
      <p className="mono-label mb-4">INDICADORES CLAVE</p>
      <div className="space-y-4">
        {HEALTH_INDICATORS.map((item) => (
          <div key={item.label} className="flex items-center justify-between">
            <span className="text-sm text-slate-400">{item.label}</span>
            <span className={`text-sm font-medium ${item.good ? 'text-emerald-400' : 'text-yellow-400'}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
