'use client';

import { useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { createCheckoutSession } from '@/lib/api/billing';

interface CheckoutButtonProps {
  planId: string;
  interval?: 'monthly' | 'yearly';
  label?: string;
  className?: string;
  variant?: 'primary' | 'secondary';
}

export function CheckoutButton({
  planId,
  interval = 'monthly',
  label,
  className = '',
  variant = 'primary',
}: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);

    try {
      const { url } = await createCheckoutSession(planId, interval);
      window.location.href = url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al iniciar el checkout';
      setError(message);
      setLoading(false);
    }
  };

  const buttonClass = variant === 'primary' ? 'btn-primary' : 'btn-secondary';
  const buttonLabel = label ?? (interval === 'yearly' ? 'Suscribirse (Anual)' : 'Suscribirse');

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className={`${buttonClass} ${className}`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CreditCard className="h-4 w-4" />
        )}
        {buttonLabel}
      </button>
      {error && (
        <p className="text-red-500 text-xs mt-1">{error}</p>
      )}
    </div>
  );
}
