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
  /** Ids de etiquetas del CRM asignadas a este cliente. */
  tags?: string[];
}

/** Colores disponibles para las etiquetas del CRM (alineados con el backend). */
export type ClientTagColor =
  | 'slate' | 'red' | 'orange' | 'amber' | 'green'
  | 'teal' | 'blue' | 'indigo' | 'violet' | 'pink';

/** Una etiqueta del catálogo del negocio. */
export interface ClientTag {
  id: string;
  label: string;
  color: ClientTagColor;
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
  /** Nota interna del equipo sobre este cliente (CRM). */
  note?: string;
}
