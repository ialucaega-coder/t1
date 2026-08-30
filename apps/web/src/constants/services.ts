export interface Service {
  id: string;
  name: string;
  duration: number;
  price: number;
  category: string;
  isActive: boolean;
}

export const MOCK_SERVICES: Service[] = [
  { id: '1', name: 'Corte caballero', duration: 30, price: 5000, category: 'Cortes', isActive: true },
  { id: '2', name: 'Corte + Peinado', duration: 60, price: 8000, category: 'Cortes', isActive: true },
  { id: '3', name: 'Color completo', duration: 120, price: 15000, category: 'Color', isActive: true },
  { id: '4', name: 'Mechas / Highlights', duration: 150, price: 20000, category: 'Color', isActive: true },
  { id: '5', name: 'Barba', duration: 20, price: 3000, category: 'Barbería', isActive: true },
  { id: '6', name: 'Corte + Barba', duration: 45, price: 7000, category: 'Barbería', isActive: true },
  { id: '7', name: 'Manicura', duration: 45, price: 4500, category: 'Uñas', isActive: false },
  { id: '8', name: 'Tratamiento capilar', duration: 60, price: 12000, category: 'Tratamientos', isActive: true },
];
