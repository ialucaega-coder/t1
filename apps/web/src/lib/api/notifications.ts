import { httpClient } from './http-client';
import type { AppNotification } from '@/types';

export function getNotifications(unreadOnly = false) {
  return httpClient.get<{ data: AppNotification[]; unreadCount: number }>(
    `/notifications${unreadOnly ? '?unreadOnly=true' : ''}`
  );
}

export function markNotificationRead(id: string) {
  return httpClient.patch(`/notifications/${id}/read`, {});
}

export function markAllRead() {
  return httpClient.patch('/notifications/read-all', {});
}
