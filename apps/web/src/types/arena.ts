export interface ArenaBuilder {
  id: string;
  name: string;
  title: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  rank: number;
  votes: number;
  github?: string;
  businessId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBuilderInput {
  name: string;
  title?: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature?: number;
}

export interface ArenaIdea {
  id: string;
  title: string;
  description: string;
  category: string;
  votes: number;
  businessId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIdeaInput {
  title: string;
  description: string;
  category: string;
}

export interface ArenaChatResponse {
  /** Respuesta del bot real del negocio. */
  reply: string;
  intent?: string;
  actions?: Array<{ type: string; payload?: Record<string, unknown> }>;
  /** Reenviar en el próximo mensaje para mantener el historial de la charla de prueba. */
  conversationId?: string;
}
