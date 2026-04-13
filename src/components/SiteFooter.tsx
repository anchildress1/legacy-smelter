import type { FC } from 'react';

interface SiteFooterProps {
  maxWidth?: string;
}

export const SiteFooter: FC<SiteFooterProps> = ({ maxWidth = 'max-w-7xl' }) => (
  <footer className="py-6 bg-concrete-mid border-t border-concrete-border mt-auto">
    <div className={`${maxWidth} mx-auto w-full px-4 sm:px-6 flex flex-col md:flex-row justify-between items-center gap-4`}>
      <p className="text-xs font-mono text-stone-gray uppercase tracking-widest">
        &copy; 2026 Ashley Childress
      </p>
      <p className="text-xs font-mono text-stone-gray uppercase tracking-widest">
        Powered by Gemini
      </p>
    </div>
  </footer>
);
