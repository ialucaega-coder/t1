export interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  stock: number;
  isActive: boolean;
  image?: string | null;
  sortOrder?: number;
  category?: { id: string; name: string };
  categoryId?: string | null;
}
