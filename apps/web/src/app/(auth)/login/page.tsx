'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Flame, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
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
        <h1 className="text-2xl font-bold text-white">Local B</h1>
        <p className="text-sm text-slate-400 mt-1">Inicia sesión en tu panel</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

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
