'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Flame, Eye, EyeOff, MailX } from 'lucide-react';
import { teamApi } from '@/lib/api/index';

// Mismo mensaje que devuelve el backend ante CUALQUIER fallo del canje (token
// inexistente, usado, vencido, email ya registrado...). No revela cuál fue.
const INVALID_PREFIX = 'La invitación no es válida';

// Misma política que el registro (el backend la vuelve a validar).
function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (password.length > 128) return 'La contraseña no puede superar los 128 caracteres.';
  if (!/[a-z]/.test(password)) return 'La contraseña debe incluir al menos una letra minúscula.';
  if (!/[A-Z]/.test(password)) return 'La contraseña debe incluir al menos una letra mayúscula.';
  if (!/[0-9]/.test(password)) return 'La contraseña debe incluir al menos un número.';
  return null;
}

export default function AceptarInvitacionPage() {
  // null = todavía leyendo la URL; '' = no había token.
  const [token, setToken] = useState<string | null>(null);
  const readRef = useRef<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(false);

  // El token viaja en el FRAGMENTO (#token=...): el navegador no lo manda al
  // servidor ni en el Referer. Lo leemos una vez y lo sacamos de la barra de
  // direcciones y del historial. Esta pantalla no consulta nada al backend
  // antes del envío, así que no muestra datos del negocio ni del invitado.
  useEffect(() => {
    if (readRef.current === null) {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const found = params.get('token') ?? '';
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      readRef.current = found.length > 0 && found.length <= 200 ? found : '';
    }
    setToken(readRef.current);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token) return;
    if (name.trim().length < 2) {
      setError('Ingresá tu nombre.');
      return;
    }
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      await teamApi.acceptInvite({ token, name: name.trim(), password });
      // Recarga completa: el contexto de sesión lee el token guardado al montar.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/dashboard';
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.startsWith(INVALID_PREFIX)) {
        setInvalid(true);
      } else if (message === 'Validation failed') {
        setError('Revisá tu nombre y que la contraseña cumpla los requisitos.');
      } else {
        setError(message || 'No pudimos completar la invitación. Probá de nuevo.');
      }
      setLoading(false);
    }
  };

  if (token === null) return null;

  if (token === '' || invalid) {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-red-500/10 mb-4">
          <MailX className="h-6 w-6 text-red-400" />
        </div>
        <h1 className="text-2xl font-bold text-white">Invitación no válida</h1>
        <p className="text-sm text-slate-400 mt-2">
          Este link no es válido o ya venció (las invitaciones se pueden usar una sola vez y duran 7 días).
          Pedile a quien te invitó que te envíe una nueva.
        </p>
        <p className="text-sm text-slate-500 mt-6">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="text-brand-400 hover:text-brand-300">
            Iniciar sesión
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-brand-500/20 mb-4">
          <Flame className="h-6 w-6 text-brand-400" />
        </div>
        <h1 className="text-2xl font-bold text-white">Aceptar invitación</h1>
        <p className="text-sm text-slate-400 mt-1">Elegí tu nombre y una contraseña para entrar al panel</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="invite-name" className="text-xs text-slate-500 mb-1 block">Tu nombre</label>
          <input
            id="invite-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            placeholder="Tu nombre completo"
            required
            maxLength={100}
            autoComplete="name"
          />
        </div>

        <div>
          <label htmlFor="invite-password" className="text-xs text-slate-500 mb-1 block">Contraseña</label>
          <div className="relative">
            <input
              id="invite-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input pr-10"
              placeholder="Mínimo 8 caracteres, con mayúscula y número"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="invite-confirm" className="text-xs text-slate-500 mb-1 block">Repetí la contraseña</label>
          <input
            id="invite-confirm"
            type={showPassword ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="input"
            placeholder="Repetí la contraseña"
            required
            maxLength={128}
            autoComplete="new-password"
          />
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
          {loading ? 'Creando tu cuenta...' : 'Aceptar y entrar'}
        </button>
      </form>

      <p className="text-sm text-slate-500 text-center mt-6">
        ¿Ya tenés cuenta?{' '}
        <Link href="/login" className="text-brand-400 hover:text-brand-300">
          Iniciar sesión
        </Link>
      </p>
    </div>
  );
}
