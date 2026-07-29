import { useState, useEffect, useCallback } from 'react';

export type NotificationPermission = 'default' | 'granted' | 'denied';

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if (!('Notification' in window)) return;
    setPermission(Notification.permission as NotificationPermission);
  }, []);

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return false;
    const result = await Notification.requestPermission();
    setPermission(result as NotificationPermission);
    return result === 'granted';
  }, []);

  const notifyOutOfStock = useCallback(
    (itemName: string) => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      new Notification(`${itemName} is out of stock`, {
        body: `Add ${itemName} to your shopping list so you don't forget to restock.`,
        icon: '/favicon.ico',
        tag: `out-of-stock-${itemName}`,
      });
    },
    []
  );

  const isSupported = 'Notification' in window;

  return { permission, requestPermission, notifyOutOfStock, isSupported };
}
