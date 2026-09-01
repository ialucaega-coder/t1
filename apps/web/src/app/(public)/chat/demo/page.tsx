'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PublicChat } from '../[botId]/PublicChat';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');

export default function DemoChatPage() {
  const [botId, setBotId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDemo() {
      try {
        const res = await fetch(`${API_BASE}/api/public/bot/demo`);
        if (res.ok) {
          const data = await res.json();
          setBotId(data.id);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    loadDemo();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F14] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-sky-400 animate-spin" />
      </div>
    );
  }

  if (!botId) {
    return (
      <div className="min-h-screen bg-[#0B0F14] flex flex-col items-center justify-center gap-4 px-4">
        <h1 className="text-xl font-semibold text-white">Demo no disponible</h1>
        <p className="text-sm text-slate-400 text-center">
          No hay un bot demo activo en este momento.
        </p>
      </div>
    );
  }

  return <PublicChat botId={botId} />;
}
