'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Save, Palette, Globe, Bell, Shield, Bot } from 'lucide-react';
import { useSettings } from '@/hooks/use-settings';
import { THEME_OPTIONS } from '@/constants/settings';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

export default function ConfiguracionPage() {
  const { settings, isLoading, error, refetch, updateSettings } = useSettings();
  const [form, setForm] = useState(settings);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await updateSettings(form);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner label="Cargando configuración..." />;
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-8">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      <section className="card">
        <div className="flex items-center gap-3 mb-4">
          <Globe className="h-5 w-5 text-brand-400" />
          <h3 className="font-semibold text-white">Datos del negocio</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Nombre del negocio</label>
            <input className="input" value={form.businessName} onChange={(e) => updateField('businessName', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Slug (URL)</label>
            <input className="input" value={form.slug} onChange={(e) => updateField('slug', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Teléfono</label>
            <input className="input" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Email</label>
            <input className="input" value={form.email} onChange={(e) => updateField('email', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-500 mb-1 block">Dirección</label>
            <input className="input" value={form.address} onChange={(e) => updateField('address', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Zona horaria</label>
            <select className="input" value={form.timezone} onChange={(e) => updateField('timezone', e.target.value)}>
              <option>America/Argentina/Buenos_Aires</option>
              <option>America/Mexico_City</option>
              <option>America/Bogota</option>
              <option>America/Santiago</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Moneda</label>
            <select className="input" value={form.currency} onChange={(e) => updateField('currency', e.target.value)}>
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
          <span className="badge-active">ACTIVO</span>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Tu panel, con tu marca. Ponle a tus bots un panel con tu logo, tu color y uno de tres estilos.
        </p>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {THEME_OPTIONS.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => updateField('theme', t.name.toLowerCase())}
              className={`rounded-lg p-4 border-2 transition-all ${
                form.theme === t.name.toLowerCase()
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
            <input
              type="color"
              value={form.accentColor}
              onChange={(e) => updateField('accentColor', e.target.value)}
              className="h-10 w-10 rounded border border-slate-700 bg-transparent cursor-pointer"
            />
            <input
              className="input max-w-[120px]"
              value={form.accentColor}
              onChange={(e) => updateField('accentColor', e.target.value)}
            />
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
          {(form.aiProviders ?? ['Claude (Anthropic)', 'ChatGPT (OpenAI)', 'Gemini (Google)', 'Grok (xAI)']).map((provider) => (
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
        <button className="btn-primary" type="submit" disabled={isSaving}>
          <Save className="h-4 w-4" /> {isSaving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
