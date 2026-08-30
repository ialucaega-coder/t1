import { httpClient } from './http-client';
import type { Transaction, CreateTransactionData, PaginatedResponse } from '@/types';

export function getTransactions(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return httpClient.get<PaginatedResponse<Transaction>>(`/transactions${qs}`);
}

export function createTransaction(data: CreateTransactionData) {
  return httpClient.post<Transaction>('/transactions', data);
}
