import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import styles from "./Studio.module.css";

type Option<T extends string> = { value: T; label: string; description?: string };
type Props<T extends string> = { label: string; value: T; options: readonly Option<T>[]; onChange: (value: T) => void; disabled?: boolean };

/** Select-only combobox. The listbox lives outside the panel so it cannot be clipped. */
export function StudioSelect<T extends string>({ label, value, options, onChange, disabled }: Props<T>) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const selected = Math.max(0, options.findIndex((option) => option.value === value));
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  const show = () => { if (!disabled) { setActive(selected); setOpen(true); } };
  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const gutter = 10; const gap = 6;
    const below = window.innerHeight - rect.bottom - gap - gutter;
    const above = rect.top - gap - gutter;
    const desired = Math.min(list.current?.scrollHeight || 240, 320);
    const upwards = below < desired && above > below;
    const maxHeight = Math.max(40, Math.min(320, upwards ? above : below));
    const width = Math.min(Math.max(rect.width, 160), window.innerWidth - gutter * 2);
    setPosition({ position: "fixed", width, left: Math.max(gutter, Math.min(rect.left, window.innerWidth - width - gutter)), maxHeight,
      top: upwards ? Math.max(gutter, rect.top - gap - Math.min(desired, maxHeight)) : rect.bottom + gap });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);
  useLayoutEffect(() => {
    // Browsers refuse focus while the initial measuring pass is visibility:hidden.
    if (open && position.visibility !== "hidden") list.current?.focus();
  }, [open, position.visibility]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (!list.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss); document.removeEventListener("focusin", dismiss);
      window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);
  useEffect(() => { if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: "nearest" }); }, [active, open, id]);
  const choose = (index: number) => { onChange(options[index].value); close(true); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab" && open) {
      // A portalled listbox is last in DOM order; continue from its trigger instead.
      event.preventDefault();
      const stops = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input, textarea, select, [tabindex]')).filter((element) =>
        element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden], [inert]') && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden");
      const next = stops[stops.indexOf(trigger.current!) + (event.shiftKey ? -1 : 1)];
      close();
      if (next) next.focus(); else trigger.current?.focus();
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!open) { show(); return; }
      if (event.key === "Enter" || event.key === " ") { choose(active); return; }
      setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (open && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const match = options.findIndex((option, index) => index !== active && option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      if (match >= 0) setActive(match);
    }
  };
  return <div className={styles.selectField}>
    <span id={`${id}-label`} className={styles.selectLabel}>{label}</span>
    <button ref={trigger} type="button" role="combobox" aria-labelledby={`${id}-label`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} disabled={disabled}
      className={`${styles.selectTrigger} ${open ? styles.selectOpen : ""}`} onClick={() => open ? close() : show()} onKeyDown={onKeyDown}>
      <span>{options[selected]?.label}</span><ChevronDown size={15} aria-hidden />
    </button>
    {open && createPortal(<div ref={list} id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} aria-activedescendant={`${id}-option-${active}`} tabIndex={-1} style={position} className={styles.selectMenu} onKeyDown={onKeyDown}>
      {options.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={option.value === value}
        className={`${styles.selectOption} ${index === active ? styles.optionActive : ""}`} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
        <span>{option.label}{option.description && <small>{option.description}</small>}</span>{option.value === value && <Check size={15} aria-hidden />}
      </div>)}
    </div>, document.body)}
  </div>;
}
