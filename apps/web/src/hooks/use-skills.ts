'use client';

import { useCallback, useEffect, useState } from 'react';
import { skillsApi } from '@/lib/api/index';
import type { Skill } from '@/constants/skills';
import { SKILLS } from '@/constants/skills';

export interface UseSkillsResult {
  skills: Skill[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSkills(): UseSkillsResult {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await skillsApi.getSkills();
        if (!cancelled) {
          // La API devuelve iconName como string; mapeamos al componente
          // Lucide correspondiente usando el catálogo local de SKILLS.
          const mapped: Skill[] = data.map((s) => {
            const match = SKILLS.find((sk) => sk.name === s.name);
            return {
              name: s.name,
              subtitle: s.subtitle,
              description: s.description,
              icon: match?.icon ?? SKILLS[0].icon,
              isActive: s.isActive,
            };
          });
          setSkills(mapped);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar habilidades');
          // Fallback a datos mock cuando la API no está disponible.
          setSkills(SKILLS);
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

  return { skills, isLoading, error, refetch };
}
