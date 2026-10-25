"use client";

import { useEffect } from "react";

export function Modal({ open, onClose, title, children, wide = false }: {
  open: boolean; onClose?: () => void; title: string; children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open || !onClose) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          {onClose && <button className="modal-x" onClick={onClose} aria-label="Close">×</button>}
        </div>
        {children}
      </div>
    </div>
  );
}
