export interface Service {
  id: string;
  name: string;
  description?: string;
  duration: number;
  price: number;
  isActive: boolean;
  image?: string | null;
  sortOrder?: number;
  category?: { id: string; name: string };
  categoryId?: string | null;
}
