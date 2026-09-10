export interface CreateAgencyClientInput {
  name: string;
  plan: string;
  status?: string;
}

export interface UpdateAgencyClientInput {
  name?: string;
  plan?: string;
  status?: string;
}
