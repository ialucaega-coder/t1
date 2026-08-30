export interface Category {
  id: string;
  name: string;
  icon?: string;
  sortOrder: number;
  _count?: { services: number; products: number };
}
