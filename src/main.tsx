import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { IncidentManifest } from './components/IncidentManifest.tsx';
import './index.css';

type Page = 'smelter' | 'manifest';

function getPageFromHash(): Page {
  return window.location.hash === '#manifest' ? 'manifest' : 'smelter';
}

function Root() {
  const [page, setPage] = useState<Page>(getPageFromHash);

  useEffect(() => {
    const onHashChange = () => setPage(getPageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigateTo = useCallback((p: Page) => {
    window.location.hash = p === 'smelter' ? '' : p;
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
