import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { IncidentManifest } from './components/IncidentManifest.tsx';
import './index.css';

type Page = 'smelter' | 'manifest';

function getPageFromHash(): Page {
  try {
    return window.location.hash === '#manifest' ? 'manifest' : 'smelter';
  } catch {
    return 'smelter';
  }
}

// Read the incident ID from /s/:id on initial load — deep link to a specific incident.
function getDeepLinkId(): string | null {
  try {
    const match = window.location.pathname.match(/^\/s\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function Root() {
  const [page, setPage] = useState<Page>(getPageFromHash);
  // Consume the deep link once: read from URL, store in state, clear the URL.
  const [deepLinkId] = useState(() => {
    const id = getDeepLinkId();
    if (id) history.replaceState(null, '', '/');
    return id;
  });

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
