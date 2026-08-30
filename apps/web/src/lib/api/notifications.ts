import { httpClient } from './http-client';
import type { AppNotification } from '@/types';

export interface NotificationsResponse {
  data: AppNotification[];
  unreadCount: number;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function getNotifications(unreadOnly = false, page = 1, pageSize = 20) {
  const params = new URLSearchParams();
  if (unreadOnly) params.set('unreadOnly', 'true');
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  return httpClient.get<NotificationsResponse>(`/notifications?${params.toString()}`);
}

export function getUnreadCount() {
  return httpClient.get<{ unreadCount: number }>('/notifications/unread-count');
}

export function markNotificationRead(id: string) {
  return httpClient.put(`/notifications/${id}/read`, {});
}

export function markAllRead() {
  return httpClient.put('/notifications/read-all', {});
}
