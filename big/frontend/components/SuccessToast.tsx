"use client";

import { useEffect, useState } from "react";

interface SuccessToastProps {
  message: string;
  txHash?: string;
  onClose: () => void;
  duration?: number;
}

export function SuccessToast({ message, txHash, onClose, duration = 5000 }: SuccessToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, duration);
    return () => clearTimeout(t);
  }, [duration, onClose]);

  if (!visible) return null;

  return (
    <div className="fixed top-20 right-4 z-50 animate-slide-in">
      <div className="rounded-xl border border-amber-500/40 bg-black shadow-2xl p-4 min-w-[280px] max-w-md">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
            <span className="text-lg">✓</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white">Success</p>
            <p className="text-sm text-neutral-300 mt-0.5">{message}</p>
            {txHash && (
              <a
                href={`https://polygonscan.com/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex text-xs text-amber-400 hover:text-amber-300 underline"
              >
                View on Polygonscan →
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setVisible(false); setTimeout(onClose, 300); }}
            className="text-neutral-400 hover:text-white text-lg leading-none"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
