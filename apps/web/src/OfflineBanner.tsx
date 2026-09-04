import { useEffect, useState } from 'react';

/**
 * The app shell precaches and loads offline, but every data screen still
 * needs the network — this makes that explicit instead of leaving a
 * customer to guess why a page won't load.
 */
export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="offline-banner" role="status">
      You're offline — the app shell is showing, but live café data needs a connection.
    </div>
  );
}
