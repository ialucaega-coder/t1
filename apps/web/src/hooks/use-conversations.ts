'use client';

import { useCallback, useEffect, useState } from 'react';
import * as conversationsApi from '@/lib/api/conversations';
import type { Conversation, ConversationDetail } from '@/lib/api/conversations';

export function useConversations(params?: { status?: string; channel?: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await conversationsApi.list({ page, ...params });
        if (!cancelled) {
          setConversations(res.data);
          setTotal(res.total);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar conversaciones');
          setConversations([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
    // `params` is destructured intentionally (status/channel) instead of used
    // as a whole object: callers often pass a new object literal on every
    // render, which would otherwise retrigger this effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken, page, params?.status, params?.channel]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const closeConversation = useCallback(async (id: string) => {
    await conversationsApi.close(id);
    refetch();
  }, [refetch]);

  return { conversations, total, page, setPage, isLoading, error, refetch, closeConversation };
}

export function useConversationDetail(id: string | null) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!id) { setDetail(null); return; }
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await conversationsApi.getById(id!);
        if (!cancelled) setDetail(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar conversación');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id, reloadToken]);

  const refetchDetail = useCallback(() => setReloadToken((t) => t + 1), []);

  return { detail, isLoading, error, refetchDetail };
}
