'use client';

import { useCallback, useEffect, useState } from 'react';
import { arenaApi } from '@/lib/api/index';
import type {
  ArenaBuilder,
  CreateBuilderInput,
  ArenaIdea,
  CreateIdeaInput,
  ArenaChatResponse,
} from '@/types/arena';

export interface UseArenaResult {
  builders: ArenaBuilder[];
  ideas: ArenaIdea[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  createBuilder: (data: CreateBuilderInput) => Promise<void>;
  voteIdea: (id: string) => Promise<void>;
  createIdea: (data: CreateIdeaInput) => Promise<void>;
  sendChat: (message: string) => Promise<ArenaChatResponse>;
}

export function useArena(): UseArenaResult {
  const [builders, setBuilders] = useState<ArenaBuilder[]>([]);
  const [ideas, setIdeas] = useState<ArenaIdea[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const [buildersRes, ideasRes] = await Promise.all([
          arenaApi.getBuilders(),
          arenaApi.getIdeas(),
        ]);
        if (!cancelled) {
          setBuilders(buildersRes);
          setIdeas(ideasRes);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar arena');
          setBuilders([]);
          setIdeas([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const createBuilder = useCallback(async (data: CreateBuilderInput) => {
    await arenaApi.createBuilder(data);
    refetch();
  }, [refetch]);

  const voteIdea = useCallback(async (id: string) => {
    await arenaApi.voteIdea(id);
    refetch();
  }, [refetch]);

  const createIdea = useCallback(async (data: CreateIdeaInput) => {
    await arenaApi.createIdea(data);
    refetch();
  }, [refetch]);

  const sendChat = useCallback(async (message: string) => {
    return arenaApi.sendChat(message);
  }, []);

  return { builders, ideas, isLoading, error, refetch, createBuilder, voteIdea, createIdea, sendChat };
}
