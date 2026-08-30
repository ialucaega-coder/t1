/**
 * Pruebas unitarias para los schemas de validacion Zod:
 * productos, pedidos y clientes.
 */
import { describe, it, expect } from 'vitest';
import { createProductSchema, updateProductSchema } from '../../validators/products';
import { createOrderSchema, updateOrderStatusSchema } from '../../validators/orders';
import { listClientsQuerySchema, updateClientSchema } from '../../validators/clients';

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------
describe('validators/products - createProductSchema', () => {
  it('parsea correctamente un producto valido con todos los campos', () => {
    const input = { name: 'Shampoo', description: 'Shampoo premium', price: 1500, stock: 10, categoryId: 'cat-1', isActive: true };
    const result = createProductSchema.parse(input);

    expect(result).toEqual(input);
  });

  it('aplica valores por defecto para stock e isActive', () => {
    const result = createProductSchema.parse({ name: 'Gel', price: 500 });

    expect(result.stock).toBe(0);
    expect(result.isActive).toBe(true);
  });

  it('rechaza cuando falta el nombre', () => {
    const result = createProductSchema.safeParse({ price: 100 });

    expect(result.success).toBe(false);
  });

  it('rechaza cuando el precio es negativo', () => {
    const result = createProductSchema.safeParse({ name: 'Cera', price: -10 });

    expect(result.success).toBe(false);
  });

  it('rechaza cuando el precio es cero', () => {
    const result = createProductSchema.safeParse({ name: 'Cera', price: 0 });

    expect(result.success).toBe(false);
  });

  it('rechaza cuando el stock es un numero decimal', () => {
    const result = createProductSchema.safeParse({ name: 'Cera', price: 100, stock: 2.5 });

    expect(result.success).toBe(false);
  });

  it('rechaza cuando el stock es negativo', () => {
    const result = createProductSchema.safeParse({ name: 'Cera', price: 100, stock: -1 });

    expect(result.success).toBe(false);
  });

  it('acepta el nombre con longitud minima de 1 caracter', () => {
    const result = createProductSchema.safeParse({ name: 'A', price: 1 });

    expect(result.success).toBe(true);
  });

  it('rechaza el nombre vacio', () => {
    const result = createProductSchema.safeParse({ name: '', price: 1 });

    expect(result.success).toBe(false);
  });
});

describe('validators/products - updateProductSchema', () => {
  it('acepta una actualizacion parcial con solo el nombre', () => {
    const result = updateProductSchema.safeParse({ name: 'Nombre nuevo' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: 'Nombre nuevo' });
  });

  it('acepta un objeto vacio (sin cambios)', () => {
    const result = updateProductSchema.safeParse({});

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------
describe('validators/orders - createOrderSchema', () => {
  it('parsea correctamente un pedido valido', () => {
    const input = {
      items: [{ productId: 'prod-1', quantity: 2 }],
      paymentMethod: 'CASH' as const,
    };
    const result = createOrderSchema.parse(input);

    expect(result.items).toHaveLength(1);
    expect(result.paymentMethod).toBe('CASH');
  });

  it('acepta multiples items y campos opcionales', () => {
    const input = {
      items: [
        { productId: 'prod-1', quantity: 1 },
        { productId: 'prod-2', quantity: 3 },
      ],
      paymentMethod: 'CARD' as const,
      clientId: 'cli-1',
      notes: 'Sin cebolla',
    };
    const result = createOrderSchema.parse(input);

    expect(result.items).toHaveLength(2);
    expect(result.clientId).toBe('cli-1');
    expect(result.notes).toBe('Sin cebolla');
  });

  it('rechaza un pedido sin items (array vacio)', () => {
    const result = createOrderSchema.safeParse({ items: [], paymentMethod: 'CASH' });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.errors.map((e) => e.message);
      expect(messages.some((m) => m.includes('al menos un item'))).toBe(true);
    }
  });

  it('rechaza un metodo de pago invalido', () => {
    const result = createOrderSchema.safeParse({
      items: [{ productId: 'p1', quantity: 1 }],
      paymentMethod: 'BITCOIN',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza cantidad negativa en un item', () => {
    const result = createOrderSchema.safeParse({
      items: [{ productId: 'p1', quantity: -1 }],
      paymentMethod: 'CASH',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza cantidad decimal en un item', () => {
    const result = createOrderSchema.safeParse({
      items: [{ productId: 'p1', quantity: 1.5 }],
      paymentMethod: 'CASH',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza productId vacio', () => {
    const result = createOrderSchema.safeParse({
      items: [{ productId: '', quantity: 1 }],
      paymentMethod: 'CASH',
    });

    expect(result.success).toBe(false);
  });
});

describe('validators/orders - updateOrderStatusSchema', () => {
  it('acepta un estado valido', () => {
    const result = updateOrderStatusSchema.safeParse({ status: 'CONFIRMED' });

    expect(result.success).toBe(true);
  });

  it('rechaza un estado inexistente', () => {
    const result = updateOrderStatusSchema.safeParse({ status: 'UNKNOWN' });

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------
describe('validators/clients - listClientsQuerySchema', () => {
  it('aplica valores por defecto para page y pageSize', () => {
    const result = listClientsQuerySchema.parse({});

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('coerce strings numericos a numeros (query params)', () => {
    const result = listClientsQuerySchema.parse({ page: '3', pageSize: '50' });

    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(50);
  });

  it('rechaza page menor a 1', () => {
    const result = listClientsQuerySchema.safeParse({ page: 0 });

    expect(result.success).toBe(false);
  });

  it('rechaza pageSize mayor a 100', () => {
    const result = listClientsQuerySchema.safeParse({ pageSize: 101 });

    expect(result.success).toBe(false);
  });

  it('acepta un filtro de busqueda opcional', () => {
    const result = listClientsQuerySchema.parse({ search: 'María' });

    expect(result.search).toBe('María');
  });
});

describe('validators/clients - updateClientSchema', () => {
  it('acepta una actualizacion con nombre y telefono', () => {
    const result = updateClientSchema.parse({ name: 'Juan', phone: '+5491155551234' });

    expect(result.name).toBe('Juan');
  });

  it('rechaza nombre con menos de 2 caracteres', () => {
    const result = updateClientSchema.safeParse({ name: 'A' });

    expect(result.success).toBe(false);
  });

  it('rechaza avatar con URL invalida', () => {
    const result = updateClientSchema.safeParse({ avatar: 'no-es-url' });

    expect(result.success).toBe(false);
  });

  it('acepta un avatar con URL valida', () => {
    const result = updateClientSchema.safeParse({ avatar: 'https://example.com/avatar.png' });

    expect(result.success).toBe(true);
  });

  it('acepta un objeto vacio (sin cambios)', () => {
    const result = updateClientSchema.safeParse({});

    expect(result.success).toBe(true);
  });
});
