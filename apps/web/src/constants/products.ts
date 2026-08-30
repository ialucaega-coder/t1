export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  isActive: boolean;
}

export const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'Shampoo Profesional 500ml', price: 8500, stock: 24, category: 'Cuidado capilar', isActive: true },
  { id: '2', name: 'Acondicionador Reparador', price: 7200, stock: 18, category: 'Cuidado capilar', isActive: true },
  { id: '3', name: 'Cera para cabello', price: 4500, stock: 32, category: 'Styling', isActive: true },
  { id: '4', name: 'Aceite de argán', price: 6800, stock: 12, category: 'Tratamientos', isActive: true },
  { id: '5', name: 'Gel fijador fuerte', price: 3200, stock: 45, category: 'Styling', isActive: true },
  { id: '6', name: 'Mascarilla capilar', price: 9500, stock: 0, category: 'Tratamientos', isActive: false },
];
