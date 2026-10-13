export type ToastTone = "default" | "success" | "error";

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) {
    l(toasts);
  }
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}

export function pushToast(message: string, tone: ToastTone = "default"): number {
  const id = nextId;
  nextId += 1;
  toasts = [...toasts, { id, message, tone }];
  emit();
  window.setTimeout(() => {
    dismissToast(id);
  }, 2500);
  return id;
}

export function dismissToast(id: number): void {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) {
    emit();
  }
}