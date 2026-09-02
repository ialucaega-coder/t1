export interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string;
  bookingsAsClient: { date: string }[];
  _count: { bookingsAsClient: number; orders: number };
}

export interface ClientDetail extends Client {
  bookingsAsClient: {
    id: string;
    date: string;
    startTime: string;
    status: string;
    service: { name: string };
  }[];
  orders: {
    id: string;
    totalPrice: number;
    status: string;
    createdAt: string;
  }[];
  notifications: {
    id: string;
    type: string;
    title: string;
    body: string;
    isRead: boolean;
    createdAt: string;
  }[];
}
