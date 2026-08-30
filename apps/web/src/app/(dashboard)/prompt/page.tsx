'use client';

import { Plus } from 'lucide-react';
import { usePrompts } from '@/hooks/use-prompts';
import { useClipboard } from '@/hooks';
import { PromptCard } from '@/components/prompts/PromptCard';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

export default function PromptPage() {
  const { prompts, isLoading, error, refetch } = usePrompts();
  const { copiedId, copy } = useClipboard();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400 max-w-2xl">
          Tus prompts y plantillas de mensaje. Cópialos y pégalos en tu agente, o úsalos como plantillas
          para notificaciones automáticas.
        </p>
        <button className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> Nuevo prompt
        </button>
      </div>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {isLoading ? (
        <LoadingSpinner label="Cargando prompts..." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {prompts.map((prompt) => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              isCopied={copiedId === prompt.id}
              onCopy={() => copy(prompt.id, prompt.content)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
