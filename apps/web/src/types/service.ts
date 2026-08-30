export interface Service {
  id: string;
  name: string;
  description?: string;
  duration: number;
  price: number;
  isActive: boolean;
  category?: { id: string; name: string };
  categoryId?: string;
}
