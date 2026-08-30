import { Bot, Key, Copy } from 'lucide-react';

const providers = [
  {
    name: 'Claude (Anthropic)',
    description: 'El modelo detrás de este mismo panel — gran balance de calidad y costo.',
    models: [
      'Haiku 4.5 — rápido y barato',
      'Sonnet 4.5 — equilibrado',
      'Sonnet 4.6 — mejor equilibrio',
      'Opus 4.6 — máxima inteligencia',
    ],
    color: 'from-amber-500/10 to-amber-600/5',
  },
  {
    name: 'ChatGPT (OpenAI)',
    description: 'La IA más conocida — modelos rápidos y económicos para volumen alto.',
    models: [
      'GPT-4o mini — rápido y barato',
      'GPT-4o — equilibrado',
      'GPT-4.1 mini — rápido',
      'GPT-4.1 — más capaz',
    ],
    color: 'from-green-500/10 to-green-600/5',
  },
  {
    name: 'Gemini (Google)',
    description: 'El cerebro de Google: barato, rapidísimo y con memoria enorme (1M de tokens).',
    models: [
      'Gemini 2.5 Flash-Lite — el más barato',
      'Gemini 2.5 Flash — equilibrado',
      'Gemini 2.5 Pro — máxima inteligencia',
    ],
    color: 'from-blue-500/10 to-blue-600/5',
  },
  {
    name: 'Grok (xAI)',
    description: 'El cerebro de xAI (el de X/Twitter): rápido y con buen manejo de herramientas.',
    models: [
      'Grok 4 Fast — rápido y barato',
      'Grok 3 mini — económico',
      'Grok 4 — más capaz',
    ],
    color: 'from-purple-500/10 to-purple-600/5',
  },
];

export default function IAPage() {
  return (
    <div className="space-y-6">
      <div className="card-accent">
        <p className="mono-label mb-1">YA VIENE INCLUIDO</p>
        <h3 className="text-lg font-bold text-white mb-2">Tu bot ya piensa solo</h3>
        <p className="text-sm text-slate-400">
          Tu bot ya piensa solo — no necesitas hacer nada aquí. Esto es para quien quiera
          usar SU PROPIA cuenta de IA: controlar el costo, tener sus propios límites, o forzar
          un modelo específico. Si no te importa eso, ignora esta página.
        </p>
      </div>

      <div>
        <p className="mono-label mb-2">BYO-LLM</p>
        <h3 className="text-lg font-bold text-white mb-2">Usa tu propia IA</h3>
        <p className="text-sm text-slate-400 mb-6">
          Enchufa tu propia cuenta de <strong className="text-white">Claude</strong>,{' '}
          <strong className="text-white">ChatGPT</strong>,{' '}
          <strong className="text-white">Gemini</strong> o{' '}
          <strong className="text-white">Grok</strong> como cerebro del bot —
          copia el prompt y tu agente se encarga: elige el modelo, saca la llave, la configura y la prueba con un mensaje real.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map((provider) => (
          <div key={provider.name} className={`card-accent bg-gradient-to-br ${provider.color}`}>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface">
                <Bot className="h-5 w-5 text-brand-400" />
              </div>
              <div>
                <h4 className="font-semibold text-white">{provider.name}</h4>
                <p className="text-xs text-slate-400">{provider.description}</p>
              </div>
            </div>
            <ul className="space-y-1.5 mb-4">
              {provider.models.map((model) => (
                <li key={model} className="text-sm text-slate-300 flex items-center gap-2">
                  <span className="text-brand-400">•</span> {model}
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <a href="#" className="mono-label hover:text-brand-300 transition-colors flex items-center gap-1">
                <Key className="h-3 w-3" /> SACAR MI API KEY →
              </a>
            </div>
            <button className="btn-secondary text-xs py-1.5 w-full mt-3">
              <Copy className="h-3 w-3" /> COPIAR PROMPT
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
