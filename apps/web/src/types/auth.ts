export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT';
  phone?: string;
  avatar?: string;
}

export interface Business {
  id: string;
  name: string;
  slug: string;
  phone?: string;
  email?: string;
  address?: string;
  timezone?: string;
  currency?: string;
}
