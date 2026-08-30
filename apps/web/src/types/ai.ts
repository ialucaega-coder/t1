export interface AIProviderStatus {
  name: string;
  configured: boolean;
}

export interface AIProvidersResponse {
  providers: AIProviderStatus[];
  defaultProvider: string | null;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatIntent = 'BOOKING' | 'CATALOG' | 'FAQ' | 'HUMAN';

export interface ChatAction {
  type: 'createBooking' | 'showCatalog' | 'checkAvailability' | 'escalateToHuman';
  payload?: Record<string, unknown>;
}

export interface ChatbotResponse {
  text: string;
  intent: ChatIntent;
  actions: ChatAction[];
}

export interface GeneratePromptResponse {
  prompt: string;
}
