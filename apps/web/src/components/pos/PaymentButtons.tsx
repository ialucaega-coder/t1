import { CreditCard, Banknote, QrCode, ArrowRightLeft } from 'lucide-react';

export interface PaymentButtonsProps {
  disabled?: boolean;
}

export function PaymentButtons({ disabled }: PaymentButtonsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button className="btn-primary text-xs justify-center" disabled={disabled}>
        <Banknote className="h-3.5 w-3.5" /> Efectivo
      </button>
      <button className="btn-secondary text-xs justify-center" disabled={disabled}>
        <CreditCard className="h-3.5 w-3.5" /> Tarjeta
      </button>
      <button className="btn-secondary text-xs justify-center" disabled={disabled}>
        <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer
      </button>
      <button className="btn-secondary text-xs justify-center" disabled={disabled}>
        <QrCode className="h-3.5 w-3.5" /> QR
      </button>
    </div>
  );
}
