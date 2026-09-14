import type { MarketplaceCategory } from '@/constants/marketplace';

export interface MarketplaceItem {
  id: string;
  name: string;
  description: string;
  category: MarketplaceCategory;
  rating: number;
  reviews: number;
  price: 'Gratis' | string;
  installed: boolean;
  author: string;
  icon: string;
}

export interface MarketplaceInstallResponse {
  success: boolean;
}
