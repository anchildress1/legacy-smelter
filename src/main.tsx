import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { IncidentManifest } from './components/IncidentManifest.tsx';
import './index.css';

type Page = 'smelter' | 'manifest';

function getPageFromHash(): Page {
  return window.location.hash === '#manifest' ? 'manifest' : 'smelter';
}

// Read the incident ID from /s/:id on initial load — deep link to a specific incident.
function getDeepLinkId(): string | null {
  const match = window.location.pathname.match(/\/s\/([^/?#]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch (err) {
    console.error('[main] Invalid deep-link incident id encoding:', err);
    return null;
  }
}

// Compute once at module load so React StrictMode remounts don't lose /s/:id.
const initialDeepLinkId = getDeepLinkId();

function Root() {
  const [page, setPage] = useState<Page>(getPageFromHash);
  // Consume the deep link once: read from URL, store in state.
  const [deepLinkId] = useState<string | null>(initialDeepLinkId);

  // Clear /s/:id after mount so the overlay only opens once.
  // Preserve non-root base paths (e.g. /app/s/:id -> /app).
  useEffect(() => {
    if (!deepLinkId) return;
    const cleanedPath = window.location.pathname.replace(/\/s\/[^/?#]+$/, '') || '/';
    history.replaceState(null, '', `${cleanedPath}${window.location.search}${window.location.hash}`);
  }, [deepLinkId]);

  useEffect(() => {
    const sync = () => setPage(getPageFromHash());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const navigateTo = useCallback((p: Page) => {
    const url = p === 'smelter'
      ? window.location.pathname + window.location.search
      : '#' + p;
    history.pushState(null, '', url);
    setPage(p);
    window.scrollTo(0, 0);
  }, []);

  if (page === 'manifest') {
    return <IncidentManifest onNavigateHome={() => navigateTo('smelter')} />;
  }
  return <App onNavigateManifest={() => navigateTo('manifest')} deepLinkId={deepLinkId} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
