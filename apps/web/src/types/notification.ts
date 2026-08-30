export interface AppNotification {
  id: string;
  type: string;
  channel: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}
