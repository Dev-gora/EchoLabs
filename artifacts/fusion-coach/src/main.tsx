import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { ThemeProvider } from './lib/theme-provider';
import { ClerkProviderWithRouter } from '@/lib/clerk-provider-with-router';

import './index.css';

// Publishable keys are public by design. Prefer the env var, but fall back to
// the project key so a deploy without VITE_CLERK_PUBLISHABLE_KEY set does not
// render a blank screen behind a "Missing publishableKey" error.
const publishableKey =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  'pk_test_ZmFpdGhmdWwtZ25hdC03NTY1LmNsZXJrLmFjY291bnRzLmRldiQ';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister();
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ThemeProvider defaultTheme="light" storageKey="echo-labs-theme">
      <ClerkProviderWithRouter publishableKey={publishableKey}>
        <App />
      </ClerkProviderWithRouter>
    </ThemeProvider>
  </ErrorBoundary>,
);
