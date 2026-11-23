import { useState, useEffect, useCallback } from 'react';
import { api, Menu, MenuDay } from '../lib/api';

export function useActiveMenu() {
  const [menu, setMenu] = useState<(Menu & { days: MenuDay[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Quietly keeps the week on screen while it is loaded again. */
  const refresh = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    try {
      if (!quiet) setLoading(true);
      setError(null);
      const data = await api.getActiveMenu();
      setMenu(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { menu, loading, error, refresh };
}

export function useMenus() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getMenus();
      setMenus(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { menus, loading, refresh };
}
