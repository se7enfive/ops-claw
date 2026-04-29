import React, { useEffect, useState, useCallback } from 'react';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toastId = 0;
let pushToast: (msg: string, type: ToastItem['type']) => void = () => {};

export const toast = {
  success: (msg: string) => pushToast(msg, 'success'),
  error: (msg: string) => pushToast(msg, 'error'),
  info: (msg: string) => pushToast(msg, 'info'),
};

export const ToastContainer: React.FC = () => {
  const [items, setItems] = useState<ToastItem[]>([]);

  pushToast = useCallback((message: string, type: ToastItem['type']) => {
    const id = ++toastId;
    setItems((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== id));
    }, 3000);
  }, []);

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={`px-4 py-3 rounded-lg shadow-lg text-white text-sm animate-slide-in max-w-sm ${
            item.type === 'success'
              ? 'bg-green-500'
              : item.type === 'error'
              ? 'bg-red-500'
              : 'bg-blue-500'
          }`}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
};
