'use client';

import { useState } from 'react';
import { Palette, Eye, Upload, Globe, Type, Monitor, Smartphone } from 'lucide-react';

const themes = [
  { name: 'Nimbus', description: 'Claro y limpio', preview: 'bg-slate-100', textColor: 'text-slate-800' },
  { name: 'Onyx', description: 'Oscuro y elegante', preview: 'bg-slate-900', textColor: 'text-white' },
  { name: 'Terra', description: 'Cálido y acogedor', preview: 'bg-amber-50', textColor: 'text-amber-900' },
];

export default function WhitelabelPage() {
  const [selectedTheme, setSelectedTheme] = useState('onyx');
  const [brandName, setBrandName] = useState('Mi Agencia');
  const [customDomain, setCustomDomain] = useState('');
  const [accentColor, setAccentColor] = useState('#38BDF8');

  return (
    <div className="space-y-8 max-w-4xl">
      <p className="text-sm text-slate-400">
        Tu panel, con tu marca. Ponle a tus bots un panel con tu logo, tu color y uno de
        tres estilos — para que tus clientes vean tu marca, no la de Local B.
      </p>

      {/* Brand name */}
      <section className="card">
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
          <Type className="h-5 w-5 text-brand-400" />
          Nombre de tu marca
        </h3>
        <div className="flex items-center gap-4">
          <input
            type="text"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            className="input max-w-sm"
            placeholder="Nombre de tu agencia"
          />
          <p className="text-xs text-slate-500">Aparece en el header del panel y en emails</p>
        </div>
      </section>

      {/* Custom domain */}
      <section className="card">
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
          <Globe className="h-5 w-5 text-brand-400" />
          Dominio personalizado
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-0 flex-1 max-w-md">
            <span className="text-sm text-slate-500 bg-surface border border-r-0 border-slate-700 rounded-l-lg px-3 py-2">
              https://
            </span>
            <input
              type="text"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              className="input rounded-l-none flex-1"
              placeholder="panel.tuagencia.com"
            />
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Apunta un CNAME de tu dominio a <code className="font-mono text-brand-400">cname.localb.app</code>
        </p>
      </section>

      {/* Logo upload */}
      <section className="card">
        <h3 className="font-semibold text-white mb-4">Tu logo</h3>
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-slate-600 bg-surface hover:border-brand-400 transition-colors cursor-pointer">
            <Upload className="h-6 w-6 text-slate-500" />
          </div>
          <div>
            <p className="text-sm text-slate-300">Sube tu logo en PNG o SVG</p>
            <p className="text-xs text-slate-500">Recomendado: 200x200px, fondo transparente</p>
          </div>
        </div>
      </section>

      {/* Theme selection */}
      <section className="card">
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
          <Palette className="h-5 w-5 text-brand-400" />
          Elige el estilo de tu panel
        </h3>
        <div className="grid grid-cols-3 gap-4">
          {themes.map((theme) => (
            <button
              key={theme.name}
              onClick={() => setSelectedTheme(theme.name.toLowerCase())}
              className={`rounded-xl overflow-hidden border-2 transition-all ${
                selectedTheme === theme.name.toLowerCase()
                  ? 'border-brand-400 shadow-lg shadow-brand-400/20'
                  : 'border-slate-700 hover:border-slate-600'
              }`}
            >
              <div className={`${theme.preview} p-6 flex flex-col items-center justify-center h-32`}>
                <div className={`w-8 h-8 rounded-lg ${selectedTheme === theme.name.toLowerCase() ? 'bg-brand-400' : 'bg-slate-400'} mb-2`} />
                <p className={`font-semibold ${theme.textColor}`}>{theme.name}</p>
                <p className={`text-xs opacity-60 ${theme.textColor}`}>{theme.description}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Accent color */}
      <section className="card">
        <h3 className="font-semibold text-white mb-4">Tu color de acento de marca</h3>
        <div className="flex items-center gap-4">
          <input
            type="color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            className="h-12 w-12 rounded-lg border border-slate-700 bg-transparent cursor-pointer"
          />
          <input
            className="input max-w-[140px]"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
          />
          <p className="text-xs text-slate-500">Se aplica a botones, links y acentos del panel</p>
        </div>
      </section>

      {/* Hide sections */}
      <section className="card">
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
          <Eye className="h-5 w-5 text-brand-400" />
          Ocultar secciones del panel de tu cliente
        </h3>
        <div className="space-y-2">
          {['Costos', 'Configuración IA', 'Arena', 'Marketplace'].map((section) => (
            <label key={section} className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-100 cursor-pointer">
              <input type="checkbox" className="rounded border-slate-600 bg-surface text-brand-400 focus:ring-brand-400" />
              <span className="text-sm text-slate-300">{section}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Preview card */}
      <section className="card">
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
          <Monitor className="h-5 w-5 text-brand-400" />
          Vista previa
        </h3>
        <div className="rounded-xl border border-slate-700 overflow-hidden">
          {/* Preview header */}
          <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-3" style={{ backgroundColor: accentColor + '15' }}>
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: accentColor }}
            >
              {brandName ? brandName[0].toUpperCase() : 'M'}
            </div>
            <span className="text-sm font-semibold text-white">{brandName || 'Mi Agencia'}</span>
            {customDomain && (
              <span className="text-[10px] text-slate-500 ml-auto font-mono">{customDomain}</span>
            )}
          </div>
          {/* Preview body */}
          <div className="p-6 bg-surface-100">
            <div className="grid grid-cols-3 gap-3">
              <div className="h-16 rounded-lg bg-surface border border-slate-700/30 flex items-center justify-center">
                <div className="h-2 w-16 rounded-full" style={{ backgroundColor: accentColor + '40' }} />
              </div>
              <div className="h-16 rounded-lg bg-surface border border-slate-700/30 flex items-center justify-center">
                <div className="h-2 w-12 rounded-full" style={{ backgroundColor: accentColor + '40' }} />
              </div>
              <div className="h-16 rounded-lg bg-surface border border-slate-700/30 flex items-center justify-center">
                <div className="h-2 w-14 rounded-full" style={{ backgroundColor: accentColor + '40' }} />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="px-4 py-1.5 rounded-lg text-xs text-white font-medium"
                style={{ backgroundColor: accentColor }}
              >
                Botón primario
              </button>
              <button
                className="px-4 py-1.5 rounded-lg text-xs font-medium border"
                style={{ borderColor: accentColor + '50', color: accentColor }}
              >
                Botón secundario
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-4">
        <button className="btn-primary">Guardar cambios</button>
        <p className="text-xs text-slate-500">Aplícalo con un prompt — sin tocar código</p>
      </div>
    </div>
  );
}
