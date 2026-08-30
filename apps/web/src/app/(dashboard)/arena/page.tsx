'use client';

import { useState } from 'react';
import { Trophy, Medal, Github, ThumbsUp, Upload, Code2, Lightbulb } from 'lucide-react';

type Tab = 'builders' | 'ideas';

const prizes = [
  { place: '1er lugar', icon: '🥇', reward: '1 año de Local B+ gratis + 30 min 1-a-1 + grupo privado de WhatsApp' },
  { place: '2do lugar', icon: '🥈', reward: '$200 USD + 30 min 1-a-1 + grupo privado de WhatsApp' },
  { place: '3er lugar', icon: '🥉', reward: '30 min 1-a-1 + acceso al grupo privado de WhatsApp' },
];

const podio = [
  { rank: 1, name: 'Luis Coutiño', title: 'Cobra por WhatsApp con Clip.mx, sin pelear con Stripe', description: 'Una objeción menos para cerrar: si el negocio ya tiene Clip, el bot ya puede cobrar.', github: true, votes: 7 },
  { rank: 2, name: 'Carlo Conti', title: '¿Tu bot tiene arreglos que le pediste a Claude? El próximo update los borra', description: 'Todo lo que tu agente parchó en src/ se borra en el próximo forjabot update, sin aviso. Este fix respalda y pregunta antes.', github: true, votes: 2 },
  { rank: 3, name: 'Arturo Bernadez', title: 'Fix: cambiar tu cron apaga en silencio la purga, los insights, el flywheel y el reporte dl', description: 'El tick nocturno se identifica comparando contra el literal "0 3 * *". Si editas tu cron en vez de agregar uno, los cuatro trabajos dejan de correr.', github: true, votes: 2 },
];

const ranking = [
  { rank: 4, name: 'Arturo Bernadez', title: 'Fix: /webhooks/manychat no valida nada, aunque la guía diga que el header X-Api-Key lo pro', votes: 1 },
  { rank: 5, name: 'María Sánchez', title: 'Nuevo template para veterinaria: citas, vacunas y recordatorios', votes: 1 },
  { rank: 6, name: 'Diego Ramos', title: 'Integración con MercadoPago checkout pro para cobros inline', votes: 0 },
];

export default function ArenaPage() {
  const [tab, setTab] = useState<Tab>('builders');

  return (
    <div className="space-y-6">
      <div className="flex rounded-lg border border-slate-700 overflow-hidden w-fit">
        <button
          onClick={() => setTab('builders')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'builders' ? 'bg-brand-400 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Code2 className="h-4 w-4" /> Builders
          <span className="text-[10px] text-slate-400">Contribuciones de código</span>
        </button>
        <button
          onClick={() => setTab('ideas')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'ideas' ? 'bg-brand-400 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Lightbulb className="h-4 w-4" /> Ideas
          <span className="text-[10px] text-slate-400">Propuestas escritas</span>
        </button>
      </div>

      <div className="card-accent">
        <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-400" /> Premios de la temporada
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          Suben código real a GitHub. Los más votados ganan — y su feature entra al core.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {prizes.map((prize) => (
            <div key={prize.place} className="card flex items-start gap-3">
              <span className="text-2xl">{prize.icon}</span>
              <div>
                <p className="text-sm font-semibold text-white">{prize.place}</p>
                <p className="text-xs text-slate-400">{prize.reward}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="mono-label">PODIO</p>
          <button className="btn-primary text-xs">
            <Upload className="h-3.5 w-3.5" /> Subir contribución
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {podio.map((entry) => (
            <div key={entry.rank} className="card-accent">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">{entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉'}</span>
              </div>
              <h4 className="font-semibold text-white text-sm mb-2">{entry.title}</h4>
              <p className="text-xs text-slate-400 mb-3">{entry.description}</p>
              {entry.github && (
                <a href="#" className="mono-label hover:text-brand-300 flex items-center gap-1 mb-3">
                  <Github className="h-3 w-3" /> GitHub ↗
                </a>
              )}
              <div className="flex items-center justify-between pt-3 border-t border-slate-700/50">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-brand-400/20 flex items-center justify-center text-[10px] font-bold text-brand-400">
                    {entry.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500">por</p>
                    <p className="text-xs text-white">{entry.name}</p>
                  </div>
                </div>
                <button className="flex items-center gap-1 text-slate-400 hover:text-brand-400">
                  <ThumbsUp className="h-3.5 w-3.5" />
                  <span className="text-sm font-bold">{entry.votes}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mono-label mb-3">RANKING</p>
        <div className="space-y-2">
          {ranking.map((entry) => (
            <div key={entry.rank} className="card flex items-center gap-4">
              <span className="text-lg font-bold text-slate-500 w-8">{entry.rank}</span>
              <div className="h-7 w-7 rounded-full bg-brand-400/20 flex items-center justify-center text-[10px] font-bold text-brand-400">
                {entry.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">{entry.title}</p>
                <p className="text-xs text-slate-500">por {entry.name}</p>
              </div>
              <button className="flex items-center gap-1 text-slate-400 hover:text-brand-400">
                <ThumbsUp className="h-3.5 w-3.5" />
                <span className="text-sm">{entry.votes}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
