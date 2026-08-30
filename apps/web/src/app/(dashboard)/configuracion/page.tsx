'use client';

import { useState } from 'react';
import { Save, Upload, Palette, Globe, Bell, Shield, Bot } from 'lucide-react';

export default function ConfiguracionPage() {
  const [theme, setTheme] = useState('onyx');

  return (
    <div className="max-w-3xl space-y-8">
      <section className="card">
        <div className="flex items-center gap-3 mb-4">
          <Globe className="h-5 w-5 text-brand-400" />
          <h3 className="font-semibold text-white">Datos del negocio</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Nombre del negocio</label>
            <input className="input" defaultValue="Mi Negocio" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Slug (URL)</label>
            <input className="input" defaultValue="mi-negocio" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Teléfono</label>
            <input className="input" defaultValue="+54 11 5555-0000" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Email</label>
            <input className="input" defaultValue="contacto@minegocio.com" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-500 mb-1 block">Dirección</label>
            <input className="input" defaultValue="Av. Corrientes 1234, CABA" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Zona horaria</label>
            <select className="input">
              <option>America/Argentina/Buenos_Aires</option>
              <option>America/Mexico_City</option>
              <option>America/Bogota</option>
              <option>America/Santiago</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Moneda</label>
            <select className="input">
              <option>ARS</option>
              <option>USD</option>
              <option>MXN</option>
              <option>COP</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex items-center gap-3 mb-4">
          <Palette className="h-5 w-5 text-brand-400" />
          <h3 className="font-semibold text-white">White-label</h3>
          <span className="badge-premium">PRO+</span>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Tu panel, con tu marca. Ponle a tus bots un panel con tu logo, tu color y uno de tres estilos.
        </p>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { name: 'Nimbus', bg: 'bg-slate-100', text: 'text-slate-800', desc: 'Claro' },
            { name: 'Onyx', bg: 'bg-slate-900', text: 'text-white', desc: 'Oscuro' },
            { name: 'Terra', bg: 'bg-amber-50', text: 'text-amber-900', desc: 'Cálido' },
          ].map((t) => (
            <button
              key={t.name}
              onClick={() => setTheme(t.name.toLowerCase())}
              className={`rounded-lg p-4 border-2 transition-all ${
                theme === t.name.toLowerCase()
                  ? 'border-brand-500'
                  : 'border-slate-700 hover:border-slate-600'
              } ${t.bg}`}
            >
              <p className={`font-semibold ${t.text}`}>{t.name}</p>
              <p className={`text-xs opacity-60 ${t.text}`}>{t.desc}</p>
            </button>
          ))}
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Color de acento</label>
          <div className="flex items-center gap-3">
            <input type="color" defaultValue="#38BDF8" className="h-10 w-10 rounded border border-slate-700 bg-transparent cursor-pointer" />
            <input className="input max-w-[120px]" defaultValue="#38BDF8" />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex items-center gap-3 mb-4">
          <Bot className="h-5 w-5 text-brand-400" />
          <h3 className="font-semibold text-white">IA — Usa tu propia IA</h3>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Enchufa tu propia cuenta de Claude, ChatGPT, Gemini o Grok como cerebro del bot.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {['Claude (Anthropic)', 'ChatGPT (OpenAI)', 'Gemini (Google)', 'Grok (xAI)'].map((provider) => (
            <div key={provider} className="card-accent flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface">
                <Bot className="h-5 w-5 text-brand-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">{provider}</p>
                <p className="text-[10px] text-slate-500 font-mono">API KEY NO CONFIGURADA</p>
              </div>
              <button className="btn-secondary text-xs py-1 px-2">Configurar</button>
            </div>
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <button className="btn-primary">
          <Save className="h-4 w-4" /> Guardar cambios
        </button>
      </div>
    </div>
  );
}
