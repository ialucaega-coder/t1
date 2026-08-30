import { z } from 'zod';

const transactionTypeEnum = z.enum(['SALE', 'REFUND', 'PARTIAL']);
const paymentMethodEnum = z.enum(['CASH', 'CARD', 'TRANSFER', 'QR']);

/** Registro manual de una transacción (venta, reembolso, etc). */
export const createTransactionSchema = z.object({
  amount: z.number().positive(),
  type: transactionTypeEnum.default('SALE'),
  paymentMethod: paymentMethodEnum,
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
