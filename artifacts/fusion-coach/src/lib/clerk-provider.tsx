import React from 'react';
import { ClerkProvider } from '@clerk/react';

export function ClerkProviderWithRouter({
  children,
  publishableKey,
  ...props
}: {
  children: React.ReactNode;
  publishableKey?: string;
}) {
  return (
    <ClerkProvider publishableKey={publishableKey} {...props}>
      {children}
    </ClerkProvider>
  );
}
