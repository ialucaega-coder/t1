'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Flame, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Segundo paso: la cuenta tiene 2FA activo y hay que pedir el código.
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  // Si perdió el celular, entra con un código de recuperación (un solo uso).
  const [useRecovery, setUseRecovery] = useState(false);
  const codeReady = useRecovery
    ? /^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(twoFactorCode.trim())
    : twoFactorCode.length === 6;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login(email, password, twoFactorRequired ? twoFactorCode : undefined);
      if (res.twoFactorRequired) {
        // Pasamos al segundo paso: mostramos el input del código de 6 dígitos.
        setTwoFactorRequired(true);
        return;
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-brand-500/20 mb-4">
          <Flame className="h-6 w-6 text-brand-400" />
        </div>
        <h1 className="text-2xl font-bold text-white">Mr. Go Assistance</h1>
        <p className="text-sm text-slate-400 mt-1">Inicia sesión en tu panel</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {!twoFactorRequired ? (
          <>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="tu@email.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-xs text-slate-500 mb-1 block">Contraseña</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pr-10"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Entrando...' : 'Iniciar sesión'}
            </button>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-brand-500/20 bg-brand-500/5 p-3 flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-brand-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-400">
                {useRecovery
                  ? 'Ingresá uno de tus códigos de recuperación. Cada uno sirve una sola vez.'
                  : 'Ingresá el código de 6 dígitos de tu app de autenticación.'}
              </p>
            </div>

            <div>
              <label htmlFor="login-2fa-code" className="text-xs text-slate-500 mb-1 block">
                {useRecovery ? 'Código de recuperación' : 'Código de verificación'}
              </label>
              {useRecovery ? (
                <input
                  id="login-2fa-code"
                  type="text"
                  maxLength={11}
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 11))}
                  className="input text-center tracking-[0.2em] font-mono text-lg uppercase"
                  placeholder="XXXXX-XXXXX"
                  required
                  autoFocus
                  autoComplete="off"
                />
              ) : (
                <input
                  id="login-2fa-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="input text-center tracking-[0.5em] font-mono text-lg"
                  placeholder="000000"
                  required
                  autoFocus
                  autoComplete="one-time-code"
                />
              )}
            </div>

            <button type="submit" disabled={loading || !codeReady} className="btn-primary w-full">
              {loading ? 'Verificando...' : 'Verificar código'}
            </button>

            <button
              type="button"
              onClick={() => {
                setUseRecovery((v) => !v);
                setTwoFactorCode('');
                setError('');
              }}
              className="text-xs text-brand-400 hover:text-brand-300 w-full text-center"
            >
              {useRecovery ? 'Usar el código de mi app' : 'Perdí mi celular: usar un código de recuperación'}
            </button>

            <button
              type="button"
              onClick={() => {
                setTwoFactorRequired(false);
                setUseRecovery(false);
                setTwoFactorCode('');
                setError('');
              }}
              className="text-xs text-slate-500 hover:text-slate-300 w-full text-center"
            >
              Volver
            </button>
          </>
        )}
      </form>

      <p className="text-sm text-slate-500 text-center mt-6">
        ¿No tienes cuenta?{' '}
        <Link href="/register" className="text-brand-400 hover:text-brand-300">
          Crear cuenta
        </Link>
      </p>

      <div className="mt-8 p-3 rounded-lg border border-slate-700/50 bg-surface-50">
        <p className="text-[10px] font-mono text-slate-500 mb-1">DEMO</p>
        <p className="text-xs text-slate-400">admin@localb.com / admin123</p>
      </div>
    </div>
  );
}
