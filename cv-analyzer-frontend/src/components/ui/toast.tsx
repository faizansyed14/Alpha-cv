import React, { useEffect, useState } from 'react';
import { Check, X, AlertCircle, Info } from 'lucide-react';

export interface ToastProps {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  onClose: (id: string) => void;
}

export function Toast({ id, type, title, message, duration = 4000, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  

  useEffect(() => {
    // Trigger entrance animation
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Auto-close after duration
    const timer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  const handleClose = () => {
    setIsLeaving(true);
    setTimeout(() => {
      onClose(id);
    }, 300); // Match animation duration
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <Check className="w-4 h-4 text-green-600" />;
      case 'error':
        return <X className="w-4 h-4 text-red-600" />;
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-amber-500" />;
      case 'info':
        return <Info className="w-4 h-4 text-blue-600" />;
      default:
        return <Check className="w-4 h-4 text-green-600" />;
    }
  };

  const getAccent = () => {
    switch (type) {
      case 'success':
        return { iconBg: 'bg-green-50', bar: 'bg-green-600' };
      case 'error':
        return { iconBg: 'bg-red-50', bar: 'bg-red-600' };
      case 'warning':
        return { iconBg: 'bg-amber-50', bar: 'bg-amber-500' };
      case 'info':
        return { iconBg: 'bg-blue-50', bar: 'bg-blue-600' };
      default:
        return { iconBg: 'bg-green-50', bar: 'bg-green-600' };
    }
  };

  const accent = getAccent();

  return (
    <div
      className={`
        max-w-sm w-full
        transform transition-all duration-300 ease-in-out
        ${isVisible && !isLeaving
          ? 'translate-x-0 opacity-100 scale-100'
          : 'translate-x-full opacity-0 scale-95'
        }
        bg-white border border-slate-200 rounded-lg shadow-lg shadow-gray-900/5 overflow-hidden
      `}
    >
      <div className="p-3.5">
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0">
            <div className={`w-7 h-7 rounded-md ${accent.iconBg} flex items-center justify-center`}>
              {getIcon()}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-[13px] font-semibold text-slate-900">
              {title}
            </h4>
            {message && (
              <p className="text-[13px] mt-0.5 text-slate-500">
                {message}
              </p>
            )}
          </div>

          <button
            onClick={handleClose}
            className="flex-shrink-0 ml-2 p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-slate-100 overflow-hidden">
        <div
          className={`h-full transition-all ease-linear ${accent.bar}`}
          style={{
            width: '100%',
            animation: `shrink ${duration}ms linear forwards`
          }}
        />
      </div>
    </div>
  );
}

// Toast Container Component
export interface ToastContainerProps {
  toasts: ToastProps[];
  onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) {
    return null;
  }
  
  return (
    <div className="fixed top-4 right-4 z-[9999] space-y-2 pointer-events-none" style={{ zIndex: 9999 }}>
      {toasts.map((toast, index) => (
        <div key={toast.id} className="pointer-events-auto" style={{ zIndex: 9999 - index }}>
          <Toast
            {...toast}
            onClose={onClose}
          />
        </div>
      ))}
    </div>
  );
}

// Hook for managing toasts
export function useToast() {
  const [toasts, setToasts] = useState<ToastProps[]>([]);

  const addToast = (toast: Omit<ToastProps, 'id' | 'onClose'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    const newToast: ToastProps = {
      ...toast,
      id,
      onClose: removeToast
    };
    
    setToasts(prev => [...prev, newToast]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  const showSuccess = (title: string, message?: string) => {
    addToast({ type: 'success', title, message });
  };

  const showError = (title: string, message?: string) => {
    addToast({ type: 'error', title, message });
  };

  const showWarning = (title: string, message?: string) => {
    addToast({ type: 'warning', title, message });
  };

  const showInfo = (title: string, message?: string) => {
    addToast({ type: 'info', title, message });
  };

  return {
    toasts,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    removeToast
  };
}