export interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  stock: number;
  isActive: boolean;
  image?: string | null;
  sortOrder?: number;
  /** ISO del último cambio; el PUT de productos lo manda como expectedUpdatedAt. */
  updatedAt?: string;
  category?: { id: string; name: string };
  categoryId?: string | null;
}
