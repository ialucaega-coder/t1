export type BookingStatus = string;
export type BookingSource = string;

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
