export type OrderStatus = string;

export interface Order {
  id: string;
  status: string;
  totalPrice: number;
  notes?: string | null;
  createdAt: string;
  client: { id: string; name: string; phone?: string };
  items: { id: string; quantity: number; price: number; product: { name: string } }[];
}

export interface CreateOrderData {
  items: { productId: string; quantity: number }[];
  paymentMethod: 'CASH' | 'CARD' | 'TRANSFER' | 'QR';
  clientId?: string;
  notes?: string;
}
