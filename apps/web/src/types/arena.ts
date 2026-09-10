export interface ArenaBuilder {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  businessId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBuilderInput {
  name: string;
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
  message: string;
  reply?: string;
  builderId?: string;
}
