import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { ToastProvider, useToast } from '../../lib/toast';

interface LayoutContentProps {
  children?: React.ReactNode;
}

function LayoutContent({ children }: LayoutContentProps) {
  const { toasts, dismissToast } = useToast();

  return (
    <div className="app">
      <Header />
      <main className="main" role="main">
        {children}
        <Outlet />
      </main>
      <div className="toast-container" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`} role="alert">
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Layout({ children }: { children?: React.ReactNode }) {
  return (
    <ToastProvider>
      <LayoutContent>
        {children}
      </LayoutContent>
    </ToastProvider>
  );
}