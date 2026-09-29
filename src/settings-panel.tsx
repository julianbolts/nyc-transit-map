import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./icons";

export function Toggle({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      id={id}
      className="toggle"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export function SettingsPanel({
  open,
  onOpenChange,
  id,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
        trigger.current?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, onOpenChange]);
  return (
    <div className="settings-container" ref={root}>
      <button
        type="button"
        ref={trigger}
        className="gear"
        aria-label="Map settings"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="settings" />
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label="Map settings"
          tabIndex={-1}
          className="settings"
        >
          {children}
        </div>
      )}
    </div>
  );
}
