import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { IncidentManifest } from './components/IncidentManifest.tsx';
import './index.css';

type Page = 'smelter' | 'manifest';

const DEEP_LINK_PATH_RE = /\/s\/([^/?#]+)$/;

function getPageFromHash(): Page {
  return globalThis.location.hash === '#manifest' ? 'manifest' : 'smelter';
}

// Read the incident ID from /s/:id on initial load — deep link to a specific incident.
function getDeepLinkId(): string | null {
  const match = DEEP_LINK_PATH_RE.exec(globalThis.location.pathname);
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
    const cleanedPath = globalThis.location.pathname.replace(DEEP_LINK_PATH_RE, '') || '/';
    history.replaceState(null, '', `${cleanedPath}${globalThis.location.search}${globalThis.location.hash}`);
  }, [deepLinkId]);

  useEffect(() => {
    const sync = () => setPage(getPageFromHash());
    globalThis.addEventListener('hashchange', sync);
    globalThis.addEventListener('popstate', sync);
    return () => {
      globalThis.removeEventListener('hashchange', sync);
      globalThis.removeEventListener('popstate', sync);
    };
  }, []);

  const navigateTo = useCallback((p: Page) => {
    const url = p === 'smelter'
      ? globalThis.location.pathname + globalThis.location.search
      : '#' + p;
    history.pushState(null, '', url);
    setPage(p);
    globalThis.scrollTo(0, 0);
  }, []);

  if (page === 'manifest') {
    return <IncidentManifest onNavigateHome={() => navigateTo('smelter')} />;
  }
  return <App onNavigateManifest={() => navigateTo('manifest')} deepLinkId={deepLinkId} />;
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');
createRoot(rootEl).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
