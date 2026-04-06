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

function Root() {
  const [page, setPage] = useState<Page>(getPageFromHash);

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
  return <App onNavigateManifest={() => navigateTo('manifest')} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
