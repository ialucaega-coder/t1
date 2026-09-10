'use client';

import { useCallback, useEffect, useState } from 'react';
import { teamApi } from '@/lib/api/index';
import type { TeamMember } from '@/constants/team';
import type { UpdateTeamMemberInput } from '@/lib/api/team';

export interface UseTeamResult {
  members: TeamMember[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  inviteMember: (data: { email: string; role: string }) => Promise<void>;
  updateMember: (id: string, data: UpdateTeamMemberInput) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
}

export function useTeam(): UseTeamResult {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await teamApi.getMembers();
        if (!cancelled) setMembers(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar miembros del equipo');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const inviteMember = useCallback(async (data: { email: string; role: string }) => {
    await teamApi.inviteMember(data);
    refetch();
  }, [refetch]);

  const updateMember = useCallback(async (id: string, data: UpdateTeamMemberInput) => {
    await teamApi.updateMember(id, data);
    refetch();
  }, [refetch]);

  const removeMember = useCallback(async (id: string) => {
    await teamApi.removeMember(id);
    refetch();
  }, [refetch]);

  return { members, isLoading, error, refetch, inviteMember, updateMember, removeMember };
}
