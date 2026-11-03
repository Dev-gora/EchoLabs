import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { ThemeProvider } from './lib/theme-provider';
import { ClerkProviderWithRouter } from '@/lib/clerk-provider-with-router';

import './index.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister();
    });
  });
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <ThemeProvider defaultTheme="light" storageKey="echo-labs-theme">
      <ClerkProviderWithRouter publishableKey={publishableKey}>
        <App />
      </ClerkProviderWithRouter>
    </ThemeProvider>
  </ErrorBoundary>,
);
