'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as conversationsApi from '@/lib/api/conversations';
import type { Conversation, ConversationDetail } from '@/lib/api/conversations';

/** Mensajes que trae cada tanda del detalle ("Cargar anteriores" pide otra igual). */
export const MESSAGES_PAGE_SIZE = 50;

/** Agrega `incoming` a `prev` sin repetir ids (una conversación nueva desplaza las páginas). */
function appendUnique(prev: Conversation[], incoming: Conversation[]): Conversation[] {
  const seen = new Set(prev.map((c) => c.id));
  return [...prev, ...incoming.filter((c) => !seen.has(c.id))];
}

export function useConversations(params?: {
  status?: string;
  channel?: string;
  view?: conversationsApi.InboxView;
  search?: string;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  // La página pertenece a una combinación de filtros: si cambian, vuelve a 1 sin
  // un efecto extra (que dispararía un segundo request).
  const filterKey = `${params?.status ?? ''}|${params?.channel ?? ''}|${params?.view ?? ''}|${params?.search ?? ''}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = useCallback((p: number) => setPageState({ key: filterKey, page: p }), [filterKey]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // `isLoading` solo es true hasta la primera carga: los refetch posteriores
  // (sockets, acciones) refrescan en silencio. Si no, la página desmonta la
  // lista y el detalle abierto en cada mensaje entrante.
  const loadedOnce = useRef(false);
  // Página y filtros vigentes para el refresco silencioso (sin re-crear el efecto).
  const pageRef = useRef(page);
  pageRef.current = page;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Carga de una página: la 1 reemplaza la lista; las siguientes se acumulan.
  useEffect(() => {
    let cancelled = false;
    const first = page === 1;

    async function load() {
      if (first) setIsLoading(!loadedOnce.current);
      else setIsLoadingMore(true);
      setError(null);
      try {
        const res = await conversationsApi.list({ page, ...params });
        if (!cancelled) {
          setConversations((prev) => (first ? res.data : appendUnique(prev, res.data)));
          setTotal(res.total);
          setHasMore(res.page * res.pageSize < res.total);
          loadedOnce.current = true;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar conversaciones');
          if (first) setConversations([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
    // `params` is destructured intentionally (status/channel) instead of used
    // as a whole object: callers often pass a new object literal on every
    // render, which would otherwise retrigger this effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, params?.status, params?.channel, params?.view, params?.search]);

  // Refresco silencioso (socket / acciones): vuelve a pedir las páginas 1..N ya
  // cargadas y reemplaza la lista, así las conversaciones nuevas suben y las que
  // dejaron de coincidir con el filtro desaparecen, sin perder el scroll cargado.
  useEffect(() => {
    if (reloadToken === 0) return;
    let cancelled = false;
    const upTo = pageRef.current;
    const current = paramsRef.current;

    Promise.all(
      Array.from({ length: upTo }, (_, i) => conversationsApi.list({ page: i + 1, ...current })),
    )
      .then((results) => {
        if (cancelled) return;
        const merged = results.reduce<Conversation[]>((acc, r) => appendUnique(acc, r.data), []);
        const last = results[results.length - 1];
        setConversations(merged);
        setTotal(last.total);
        setHasMore(last.page * last.pageSize < last.total);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar conversaciones');
      });
    return () => { cancelled = true; };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  /** Trae la página siguiente (si hay y no hay una carga en curso). */
  const loadMore = useCallback(() => {
    if (hasMore && !isLoading && !isLoadingMore) setPage(page + 1);
  }, [hasMore, isLoading, isLoadingMore, page, setPage]);

  const closeConversation = useCallback(async (id: string) => {
    await conversationsApi.close(id);
    refetch();
  }, [refetch]);

  return {
    conversations, total, page, setPage, hasMore, loadMore,
    isLoading, isLoadingMore, error, refetch, closeConversation,
  };
}

export function useConversationDetail(id: string | null) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // Id cuyo detalle ya se mostró: recargar la MISMA conversación (mensaje nuevo
  // por socket) no debe volver a poner el spinner ni remontar el textarea.
  const loadedId = useRef<string | null>(null);
  // Cuántas veces se prepusieron mensajes anteriores: la página lo usa para NO
  // saltar al final del hilo cuando lo que cambió es el principio.
  const [prependCount, setPrependCount] = useState(0);
  // Estado vigente para leerlo dentro del efecto async sin cerrarlo (ni re-crearlo).
  const detailRef = useRef<ConversationDetail | null>(null);
  detailRef.current = detail;
  const hasMoreRef = useRef(false);
  hasMoreRef.current = hasMoreMessages;

  useEffect(() => {
    if (!id) { setDetail(null); setHasMoreMessages(false); loadedId.current = null; return; }
    let cancelled = false;
    const sameConversation = loadedId.current === id;

    async function load() {
      setIsLoading(!sameConversation);
      setError(null);
      try {
        const res = await conversationsApi.getById(id!, { limit: MESSAGES_PAGE_SIZE });
        if (cancelled) return;
        loadedId.current = id;
        // Refresco de la misma charla: conserva los mensajes anteriores que el
        // usuario ya cargó (los que quedan antes del primero de la tanda nueva).
        const prev = detailRef.current;
        let next = res;
        let more = Boolean(res.hasMoreMessages);
        if (sameConversation && prev && prev.id === res.id && res.messages.length > 0) {
          const idx = prev.messages.findIndex((m) => m.id === res.messages[0].id);
          if (idx > 0) {
            next = { ...res, messages: [...prev.messages.slice(0, idx), ...res.messages] };
            more = hasMoreRef.current;
          }
        }
        setDetail(next);
        setHasMoreMessages(more);
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

  /** Trae la tanda de mensajes anteriores al más viejo cargado y la antepone. */
  const loadOlder = useCallback(async () => {
    if (!id || !detail || detail.messages.length === 0 || isLoadingOlder) return;
    setIsLoadingOlder(true);
    try {
      const res = await conversationsApi.getById(id, {
        limit: MESSAGES_PAGE_SIZE,
        before: detail.messages[0].id,
      });
      setDetail((prev) => {
        if (!prev || prev.id !== res.id) return prev;
        const seen = new Set(prev.messages.map((m) => m.id));
        return { ...prev, messages: [...res.messages.filter((m) => !seen.has(m.id)), ...prev.messages] };
      });
      setHasMoreMessages(Boolean(res.hasMoreMessages));
      setPrependCount((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar mensajes anteriores');
    } finally {
      setIsLoadingOlder(false);
    }
  }, [id, detail, isLoadingOlder]);

  return { detail, isLoading, error, refetchDetail, hasMoreMessages, isLoadingOlder, loadOlder, prependCount };
}
