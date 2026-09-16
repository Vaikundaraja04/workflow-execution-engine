import { create } from 'zustand';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  duration?: number;
}

interface UiState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark' | 'system';
  toasts: ToastItem[];
  activeModal: string | null;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  addToast: (toast: Omit<ToastItem, 'id'>) => string;
  removeToast: (id: string) => void;
  openModal: (modalId: string) => void;
  closeModal: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarOpen: true,
  theme: 'system',
  toasts: [],
  activeModal: null,

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),

  setTheme: (theme: 'light' | 'dark' | 'system') => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', theme);
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else if (theme === 'light') {
        document.documentElement.classList.remove('dark');
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
    }
    set({ theme });
  },

  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const newToast: ToastItem = { ...toast, id, duration: toast.duration ?? 5000 };
    set((state) => ({ toasts: [...state.toasts, newToast] }));

    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, newToast.duration);
    }
    return id;
  },

  removeToast: (id: string) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  openModal: (modalId: string) => set({ activeModal: modalId }),
  closeModal: () => set({ activeModal: null }),
}));
