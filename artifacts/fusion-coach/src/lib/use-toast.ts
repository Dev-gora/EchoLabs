import * as React from 'react';

export interface ToastProps {
  id: string;
  title?: string | null;
  description?: string | null;
  action?: {
    altText: string;
    onClick?: (() => void) | React.MouseEventHandler<HTMLButtonElement> | undefined;
  } | null;
  duration?: number;
}

export interface UseToastReturn {
  toast: (props: Omit<ToastProps, 'id'>) => void;
  dismiss: (id: string) => void;
  toasts: Array<ToastProps & { id: string }>;
}

export function useToast(options?: { duration?: number }): UseToastReturn {
  const duration = options?.duration ?? 5000;
  const [toasts, setToasts] = React.useState<Array<ToastProps & { id: string }>>([]);

  const toast = React.useCallback(
    (props: Omit<ToastProps, 'id'>) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { ...props, id }]);
    },
    [],
  );

  const dismiss = React.useCallback(
    (id: string) => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [],
  );

  return { toast, dismiss, toasts };
}

export const toast = () => {
  throw new Error('useToast must be called within a component');
};
