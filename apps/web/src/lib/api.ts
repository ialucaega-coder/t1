// Backward-compatible entry point for the legacy `api` singleton.
// New code should prefer importing from '@/lib/api/index' (or the individual
// domain modules under '@/lib/api/') directly.
import { httpClient } from './api/http-client';
import * as authApi from './api/auth';
import * as bookingsApi from './api/bookings';
import * as servicesApi from './api/services';
import * as productsApi from './api/products';
import * as clientsApi from './api/clients';
import * as ordersApi from './api/orders';
import * as transactionsApi from './api/transactions';
import * as notificationsApi from './api/notifications';
import * as categoriesApi from './api/categories';
import * as professionalsApi from './api/professionals';
import * as schedulesApi from './api/schedules';
import * as statsApi from './api/stats';

import type {
  Booking,
  CreateBookingData,
  Service,
  Product,
  Client,
  Order,
  CreateOrderData,
  Transaction,
  CreateTransactionData,
  Category,
  Professional,
  Schedule,
  StatsOverview,
  WeeklyData,
  TopService,
} from '@/types';

export { httpClient } from './api/http-client';
export { API_URL } from './api/http-client';

class ApiClient {
  setToken(token: string | null) {
    httpClient.setToken(token);
  }

  getToken(): string | null {
    return httpClient.getToken();
  }

  get<T>(path: string) {
    return httpClient.get<T>(path);
  }

  post<T>(path: string, body: unknown) {
    return httpClient.post<T>(path, body);
  }

  put<T>(path: string, body: unknown) {
    return httpClient.put<T>(path, body);
  }

  patch<T>(path: string, body: unknown) {
    return httpClient.patch<T>(path, body);
  }

  delete<T>(path: string) {
    return httpClient.delete<T>(path);
  }

  // Auth
  login(email: string, password: string) {
    return authApi.login(email, password);
  }

  register(data: { email: string; password: string; name: string; businessName: string }) {
    return authApi.register(data);
  }

  logout() {
    authApi.logout();
  }

  // Bookings
  getBookings(params?: Record<string, string>) {
    return bookingsApi.getBookings(params);
  }
  createBooking(data: CreateBookingData) {
    return bookingsApi.createBooking(data);
  }
  updateBookingStatus(id: string, status: string) {
    return bookingsApi.updateBookingStatus(id, status);
  }
  deleteBooking(id: string) {
    return bookingsApi.deleteBooking(id);
  }

  // Services
  getServices() {
    return servicesApi.getServices();
  }
  createService(data: Partial<Service>) {
    return servicesApi.createService(data);
  }
  updateService(id: string, data: Partial<Service>) {
    return servicesApi.updateService(id, data);
  }

  // Products
  getProducts() {
    return productsApi.getProducts();
  }
  createProduct(data: Partial<Product>) {
    return productsApi.createProduct(data);
  }
  updateProduct(id: string, data: Partial<Product>) {
    return productsApi.updateProduct(id, data);
  }

  // Clients
  getClients(search?: string) {
    return clientsApi.getClients({ search });
  }

  // Orders
  getOrders(params?: Record<string, string>) {
    return ordersApi.getOrders(params);
  }
  createOrder(data: CreateOrderData) {
    return ordersApi.createOrder(data);
  }
  updateOrderStatus(id: string, status: string) {
    return ordersApi.updateOrderStatus(id, status);
  }

  // Transactions
  getTransactions(params?: Record<string, string>) {
    return transactionsApi.getTransactions(params);
  }
  createTransaction(data: CreateTransactionData) {
    return transactionsApi.createTransaction(data);
  }

  // Notifications
  getNotifications(unreadOnly = false) {
    return notificationsApi.getNotifications(unreadOnly);
  }
  markNotificationRead(id: string) {
    return notificationsApi.markNotificationRead(id);
  }
  markAllRead() {
    return notificationsApi.markAllRead();
  }

  // Categories
  getCategories() {
    return categoriesApi.getCategories();
  }
  createCategory(data: { name: string; icon?: string }) {
    return categoriesApi.createCategory(data);
  }
  updateCategory(id: string, data: Partial<Category>) {
    return categoriesApi.updateCategory(id, data);
  }
  deleteCategory(id: string) {
    return categoriesApi.deleteCategory(id);
  }

  // Professionals
  getProfessionals() {
    return professionalsApi.getProfessionals();
  }
  getProfessional(id: string) {
    return professionalsApi.getProfessional(id);
  }
  getAvailability(professionalId: string, date: string) {
    return professionalsApi.getAvailability(professionalId, date);
  }

  // Schedules
  getSchedules(professionalId?: string) {
    return schedulesApi.getSchedules(professionalId);
  }
  createSchedule(data: Partial<Schedule>) {
    return schedulesApi.createSchedule(data);
  }
  updateSchedule(id: string, data: Partial<Schedule>) {
    return schedulesApi.updateSchedule(id, data);
  }
  deleteSchedule(id: string) {
    return schedulesApi.deleteSchedule(id);
  }

  // Stats
  getOverview() {
    return statsApi.getOverview();
  }
  getWeeklyStats() {
    return statsApi.getWeeklyStats();
  }
  getTopServices() {
    return statsApi.getTopServices();
  }
}

export const api = new ApiClient();

// Types (re-exported from the canonical @/types location for backward compatibility)
export type {
  User,
  Business,
  Booking,
  CreateBookingData,
  Service,
  Product,
  Client,
  Order,
  CreateOrderData,
  Transaction,
  CreateTransactionData,
  Category,
  Professional,
  Schedule,
  StatsOverview,
  WeeklyData,
  TopService,
  PaginatedResponse,
  AppNotification,
  AppNotification as Notification,
} from '@/types';
