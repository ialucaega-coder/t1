import { z } from 'zod';

/** Máximo representable en una columna Decimal(10,2). */
export const MAX_MONEY = 99_999_999.99;

const transactionTypeEnum = z.enum(['SALE', 'REFUND', 'PARTIAL']);
const paymentMethodEnum = z.enum(['CASH', 'CARD', 'TRANSFER', 'QR']);

/** Registro manual de una transacción (venta, reembolso, etc). */
export const createTransactionSchema = z.object({
  // La columna es Decimal(10,2): tope 99.999.999,99. Se valida acá para dar un 400 claro.
  amount: z.number().positive().max(MAX_MONEY, 'El monto no puede superar $99.999.999,99'),
  type: transactionTypeEnum.default('SALE'),
  paymentMethod: paymentMethodEnum,
  reference: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
