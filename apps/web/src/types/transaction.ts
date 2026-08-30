export interface Transaction {
  id: string;
  amount: number;
  type: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  createdAt: string;
}

export interface CreateTransactionData {
  amount: number;
  type?: string;
  paymentMethod: 'CASH' | 'CARD' | 'TRANSFER' | 'QR';
  reference?: string;
  notes?: string;
}
