import { httpClient } from './http-client';
import type { Transaction, CreateTransactionData, PaginatedResponse } from '@/types';

export function getTransactions(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return httpClient.get<PaginatedResponse<Transaction>>(`/transactions${qs}`);
}

export function createTransaction(data: CreateTransactionData) {
  return httpClient.post<Transaction>('/transactions', data);
}

export function exportCsv() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  return fetch(`${API_URL}/transactions/export/csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(async (res) => {
    if (!res.ok) throw new Error('Error al exportar');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'movimientos.csv';
    a.click();
    URL.revokeObjectURL(url);
  });
}
