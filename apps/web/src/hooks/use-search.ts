'use client';

import { useState } from 'react';

export function useSearch<T>(items: T[], searchFn: (item: T, query: string) => boolean) {
  const [query, setQuery] = useState('');

  const filtered = query ? items.filter(item => searchFn(item, query)) : items;

  return { query, setQuery, filtered, isFiltering: !!query };
}
