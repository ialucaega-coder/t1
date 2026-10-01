'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CalendarIcon,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { useToast } from '@/components/common/Toast';
import {
  getCalcomStatus,
  getCalcomEventTypes,
  connectCalcom,
  disconnectCalcom,
  type CalcomStatus,
  type CalcomEventType,
} from '@/lib/api/calcom';

// ────────────────────────────────────────────────────────────────
// Componente: Tarjeta de conexion Cal.com (agenda externa, funcional)
// Imita el patrón de TelegramCard.
// ────────────────────────────────────────────────────────────────

export function CalcomCard() {
  const { toast } = useToast();

  const [status, setStatus] = useState<CalcomStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Tipos de evento: se cargan tras conectar. Guardamos la apiKey en memoria
  // (solo durante esta sesión de la tarjeta) para poder re-conectar fijando el
  // eventTypeId elegido. Si la página se recarga, la apiKey se pierde y el
  // selector no aparece (queda para una mejora futura cargar event types sin
  // la key en el front).
  const [sessionApiKey, setSessionApiKey] = useState('');
  const [eventTypes, setEventTypes] = useState<CalcomEventType[]>([]);
  const [isSavingEventType, setIsSavingEventType] = useState(false);

  const isConnected = status?.connected ?? false;

  const loadStatus = useCallback(async () => {
    try {
      const data = await getCalcomStatus();
      setStatus(data);
    } catch {
      toast({ type: 'error', message: 'No se pudo cargar el estado de Cal.com' });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Carga los tipos de evento para poder elegir el eventTypeId.
  const loadEventTypes = useCallback(async () => {
    try {
      const { eventTypes: types } = await getCalcomEventTypes();
      setEventTypes(types);
    } catch {
      // No es crítico: la tarjeta sigue funcionando sin el selector.
      setEventTypes([]);
    }
  }, []);

  const handleConnect = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setIsConnecting(true);
    try {
      const newStatus = await connectCalcom(key);
      setStatus(newStatus);
      setSessionApiKey(key);
      setApiKey('');
      toast({ type: 'success', message: 'Cal.com conectado exitosamente' });
      // Cargamos los tipos de evento para permitir elegir el eventTypeId.
      await loadEventTypes();
    } catch (err) {
      // El backend responde 400 ("API key inválida") ante una key incorrecta.
      const message = err instanceof Error ? err.message : 'API key inválida';
      toast({ type: 'error', message });
    }
    setIsConnecting(false);
  };

  // Re-conecta fijando el eventTypeId elegido. Requiere tener la apiKey de la
  // sesión (recién conectada); si no, no mostramos el selector.
  const handleSelectEventType = async (eventTypeId: number) => {
    if (!sessionApiKey) return;
    setIsSavingEventType(true);
    try {
      const newStatus = await connectCalcom(sessionApiKey, eventTypeId);
      setStatus(newStatus);
      toast({ type: 'success', message: 'Tipo de evento actualizado' });
    } catch {
      toast({ type: 'error', message: 'No se pudo guardar el tipo de evento' });
    }
    setIsSavingEventType(false);
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const newStatus = await disconnectCalcom();
      setStatus(newStatus);
      setSessionApiKey('');
      setEventTypes([]);
      toast({ type: 'success', message: 'Cal.com desconectado' });
    } catch {
      toast({ type: 'error', message: 'Error al desconectar Cal.com' });
    }
    setIsDisconnecting(false);
  };

  return (
    <div className="card-accent p-6 border border-brand-400/20">
      {/* Encabezado */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-400/10">
            <CalendarIcon className="h-6 w-6 text-brand-400" />
          </div>
          <div>
            <h4 className="font-semibold text-white text-lg">Cal.com</h4>
            <p className="text-xs text-slate-400">Agenda externa — tus clientes reservan turnos</p>
          </div>
        </div>
        {isLoading ? (
          <Loader2 className="h-5 w-5 text-slate-400 animate-spin" />
        ) : isConnected ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Conectado
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <XCircle className="h-4 w-4" />
            Desconectado
          </span>
        )}
      </div>

      {/* Estado desconectado: form para la API key */}
      {!isLoading && !isConnected && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">API key de Cal.com</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="cal_live_..."
                className="input flex-1 font-mono text-sm"
                disabled={isConnecting}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
              <button
                onClick={handleConnect}
                className="btn-primary px-4"
                disabled={isConnecting || !apiKey.trim()}
              >
                {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Conectar'}
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Generá tu API key desde{' '}
            <a
              href="https://cal.com/docs/api-reference"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-400 hover:underline inline-flex items-center gap-1"
            >
              la documentación de Cal.com <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      )}

      {/* Estado conectado */}
      {!isLoading && isConnected && (
        <div className="space-y-4">
          <div className="bg-surface-100 rounded-lg p-4">
            <p className="text-sm text-white font-medium">Cuenta de Cal.com conectada</p>
            <p className="text-xs text-slate-400 mt-1">
              {status?.eventTypeId != null
                ? `Tipo de evento seleccionado: #${status.eventTypeId}`
                : 'Sin tipo de evento específico (se usa el predeterminado)'}
            </p>
          </div>

          {/* Selector de tipo de evento: solo disponible en la misma sesión en
              que se conectó (tenemos la apiKey en memoria). */}
          {sessionApiKey && eventTypes.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Tipo de evento</label>
              <select
                value={status?.eventTypeId ?? ''}
                onChange={(e) => handleSelectEventType(Number(e.target.value))}
                className="input w-full"
                disabled={isSavingEventType}
              >
                <option value="" disabled>
                  Elegí un tipo de evento
                </option>
                {eventTypes.map((et) => (
                  <option key={et.id} value={et.id}>
                    {et.title} ({et.length} min)
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handleDisconnect}
            className="btn-secondary w-full text-red-400 hover:text-red-300 border-red-500/20 hover:border-red-500/40"
            disabled={isDisconnecting}
          >
            {isDisconnecting ? (
              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
            ) : (
              'Desconectar'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
