import { httpClient } from './http-client';
import type { CommandGroup } from '@/constants/commands';

export function getCommands() {
  return httpClient.get<CommandGroup[]>('/commands');
}
