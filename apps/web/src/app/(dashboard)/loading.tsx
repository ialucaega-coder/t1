export default function DashboardLoading() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="h-8 w-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-xs text-slate-500">Cargando...</p>
      </div>
    </div>
  );
}
