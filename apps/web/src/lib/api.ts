const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      if (typeof window !== 'undefined') localStorage.setItem('auth_token', token);
    } else {
      if (typeof window !== 'undefined') localStorage.removeItem('auth_token');
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('auth_token');
    }
    return this.token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      this.setToken(null);
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      throw new Error('Unauthorized');
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    if (res.status === 204) return null as T;
    return res.json();
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  put<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  patch<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }

  // Auth
  async login(email: string, password: string) {
    const res = await this.post<{ token: string; user: User; business: Business }>('/auth/login', { email, password });
    this.setToken(res.token);
    return res;
  }

  async register(data: { email: string; password: string; name: string; businessName: string }) {
    const res = await this.post<{ token: string; user: User; business: Business }>('/auth/register', data);
    this.setToken(res.token);
    return res;
  }

  logout() {
    this.setToken(null);
  }

  // Bookings
  getBookings(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.get<Booking[]>(`/bookings${qs}`);
  }
  createBooking(data: CreateBookingData) { return this.post<Booking>('/bookings', data); }
  updateBookingStatus(id: string, status: string) { return this.patch<Booking>(`/bookings/${id}/status`, { status }); }
  deleteBooking(id: string) { return this.delete(`/bookings/${id}`); }

  // Services
  getServices() { return this.get<Service[]>('/services'); }
  createService(data: Partial<Service>) { return this.post<Service>('/services', data); }
  updateService(id: string, data: Partial<Service>) { return this.put<Service>(`/services/${id}`, data); }

  // Products
  getProducts() { return this.get<Product[]>('/products'); }
  createProduct(data: Partial<Product>) { return this.post<Product>('/products', data); }
  updateProduct(id: string, data: Partial<Product>) { return this.put<Product>(`/products/${id}`, data); }

  // Clients
  getClients(search?: string) {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return this.get<Client[]>(`/clients${qs}`);
  }

  // Orders
  getOrders(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.get<PaginatedResponse<Order>>(`/orders${qs}`);
  }
  createOrder(data: CreateOrderData) { return this.post<Order>('/orders', data); }
  updateOrderStatus(id: string, status: string) { return this.patch<Order>(`/orders/${id}/status`, { status }); }

  // Transactions
  getTransactions(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.get<PaginatedResponse<Transaction>>(`/transactions${qs}`);
  }
  createTransaction(data: CreateTransactionData) { return this.post<Transaction>('/transactions', data); }

  // Notifications
  getNotifications(unreadOnly = false) {
    return this.get<{ data: Notification[]; unreadCount: number }>(`/notifications${unreadOnly ? '?unreadOnly=true' : ''}`);
  }
  markNotificationRead(id: string) { return this.patch(`/notifications/${id}/read`, {}); }
  markAllRead() { return this.patch('/notifications/read-all', {}); }

  // Categories
  getCategories() { return this.get<Category[]>('/categories'); }
  createCategory(data: { name: string; icon?: string }) { return this.post<Category>('/categories', data); }
  updateCategory(id: string, data: Partial<Category>) { return this.put<Category>(`/categories/${id}`, data); }
  deleteCategory(id: string) { return this.delete(`/categories/${id}`); }

  // Professionals
  getProfessionals() { return this.get<Professional[]>('/professionals'); }
  getProfessional(id: string) { return this.get<Professional>(`/professionals/${id}`); }
  getAvailability(professionalId: string, date: string) {
    return this.get<{ available: boolean; slots: string[] }>(`/professionals/${professionalId}/availability?date=${date}`);
  }

  // Schedules
  getSchedules(professionalId?: string) {
    const qs = professionalId ? `?professionalId=${professionalId}` : '';
    return this.get<Schedule[]>(`/schedules${qs}`);
  }
  createSchedule(data: Partial<Schedule>) { return this.post<Schedule>('/schedules', data); }
  updateSchedule(id: string, data: Partial<Schedule>) { return this.put<Schedule>(`/schedules/${id}`, data); }
  deleteSchedule(id: string) { return this.delete(`/schedules/${id}`); }

  // Stats
  getOverview() { return this.get<StatsOverview>('/stats/overview'); }
  getWeeklyStats() { return this.get<WeeklyData[]>('/stats/weekly'); }
  getTopServices() { return this.get<TopService[]>('/stats/top-services'); }
}

export const api = new ApiClient();

// Types
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

export interface Booking {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  source: string;
  notes?: string;
  totalPrice: number;
  client: { id: string; name: string; phone?: string; email?: string };
  professional: { id: string; user: { name: string } };
  service: { id: string; name: string; duration: number; price: number };
}

export interface CreateBookingData {
  date: string;
  startTime: string;
  serviceId: string;
  professionalId: string;
  clientId?: string;
  notes?: string;
  source?: string;
}

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

export interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  stock: number;
  isActive: boolean;
  category?: { id: string; name: string };
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
  createdAt: string;
  bookingsAsClient: { date: string }[];
  _count: { bookingsAsClient: number };
}

export interface Order {
  id: string;
  status: string;
  totalPrice: number;
  notes?: string;
  createdAt: string;
  client: { id: string; name: string };
  items: { id: string; quantity: number; price: number; product: { name: string } }[];
}

export interface CreateOrderData {
  items: { productId: string; quantity: number }[];
  paymentMethod: 'CASH' | 'CARD' | 'TRANSFER' | 'QR';
  clientId?: string;
  notes?: string;
}

export interface Transaction {
  id: string;
  amount: number;
  type: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  createdAt: string;
}

export interface CreateTransactionData {
  amount: number;
  type?: string;
  paymentMethod: 'CASH' | 'CARD' | 'TRANSFER' | 'QR';
  reference?: string;
  notes?: string;
}

export interface Notification {
  id: string;
  type: string;
  channel: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  icon?: string;
  sortOrder: number;
  _count?: { services: number; products: number };
}

export interface Professional {
  id: string;
  bio?: string;
  specialties: string[];
  isAvailable: boolean;
  user: { id: string; name: string; email: string; phone?: string };
  schedules: Schedule[];
  _count: { bookings: number };
}

export interface Schedule {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
  professionalId: string;
}

export interface StatsOverview {
  todayBookings: number;
  monthBookings: number;
  bookingChange: string;
  totalClients: number;
  revenue: number;
  revenueChange: string;
  activeServices: number;
  totalProducts: number;
  noShowRate: string;
  noShowChange: string;
}

export interface WeeklyData {
  date: string;
  day: string;
  bookings: number;
  revenue: number;
}

export interface TopService {
  id: string;
  name: string;
  bookingCount: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
}
