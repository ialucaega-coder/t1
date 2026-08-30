export interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
  createdAt: string;
  bookingsAsClient: { date: string }[];
  _count: { bookingsAsClient: number };
}
