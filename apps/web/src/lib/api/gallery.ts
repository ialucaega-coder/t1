import { httpClient } from './http-client';

export type GalleryTipo = 'image' | 'video' | 'audio';

export interface GalleryItem {
  id: string;
  url: string;
  tipo: GalleryTipo;
  titulo: string;
  descripcion: string;
  createdAt: string;
}

export interface CreateGalleryItemInput {
  url: string;
  tipo: GalleryTipo;
  titulo?: string;
  descripcion?: string;
}

export function getGallery() {
  return httpClient.get<GalleryItem[]>('/galeria');
}

export function createGalleryItem(data: CreateGalleryItemInput) {
  return httpClient.post<GalleryItem>('/galeria', data);
}

export function deleteGalleryItem(itemId: string) {
  return httpClient.delete<{ success: boolean }>(`/galeria/${itemId}`);
}
