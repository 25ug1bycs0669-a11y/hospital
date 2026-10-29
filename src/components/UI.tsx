import { useEffect, type FormEvent, type PropsWithChildren, type ReactNode } from "react";
import { X, Search, ChevronLeft, ChevronRight, LoaderCircle, AlertCircle } from "lucide-react";

export function PageHeader({ eyebrow, title, description, action }: {
  eyebrow?: string; title: string; description?: string; action?: ReactNode;
}) {
  return <div className="page-header">
    <div><p className="eyebrow">{eyebrow ?? new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</p>
      <h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>
    {action && <div className="page-action">{action}</div>}
  </div>;
}

export function Button({ children, variant = "primary", className = "", ...props }: PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }>) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

export function SearchField({ value, onChange, placeholder = "Search..." }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="search-field"><Search size={16} aria-hidden="true" /><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>;
}

export function Panel({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function PanelTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="panel-title"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

export function Modal({ title, onClose, children, wide = false }: PropsWithChildren<{ title: string; onClose: () => void; wide?: boolean }>) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      <div className="modal-body">{children}</div>
    </section>
  </div>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status.toLowerCase().includes("cancel") || status.toLowerCase().includes("maintenance") ? "red"
    : status.toLowerCase().includes("pending") || status.toLowerCase().includes("occupied") || status.toLowerCase().includes("waiting") ? "amber"
      : status.toLowerCase().includes("partial") ? "blue" : "green";
  return <span className={`status-badge status-${tone}`}><span />{status}</span>;
}

export function Loading({ label = "Loading data..." }: { label?: string }) {
  return <div className="loading-state" role="status"><LoaderCircle className="spin" size={20} />{label}</div>;
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-state" role="alert"><AlertCircle size={18} /><span>{message}</span>{retry && <Button variant="secondary" onClick={retry}>Try again</Button>}</div>;
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return <div className="empty-state"><span className="empty-mark">+</span><strong>{title}</strong>{description && <p>{description}</p>}</div>;
}

export function DataTable({ children, headers, empty, loading }: PropsWithChildren<{ headers: string[]; empty?: boolean; loading?: boolean }>) {
  if (loading) return <Loading />;
  return <div className="table-scroll"><table className="data-table"><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead>
    <tbody>{children}</tbody></table>{empty && <EmptyState title="No records found" description="Try adjusting your search or add a new record." />}</div>;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="pagination"><span>Showing {total ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, total)} of {total}</span>
    <div><button className="icon-button small" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={15} /></button>
      <span className="page-number">{page} / {pages}</span>
      <button className="icon-button small" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={15} /></button></div>
  </div>;
}

export function FormField({ label, children, required = false }: PropsWithChildren<{ label: string; required?: boolean }>) {
  return <label className="form-field"><span>{label}{required && <em> *</em>}</span>{children}</label>;
}

export function FormActions({ onCancel, pending, submit = "Save changes" }: { onCancel: () => void; pending?: boolean; submit?: string }) {
  return <div className="form-actions"><Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
    <Button type="submit" disabled={pending}>{pending && <LoaderCircle size={15} className="spin" />}{pending ? "Saving..." : submit}</Button></div>;
}

export function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onClose, 3500);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);
  return message ? <div className="toast" role="status">{message}<button aria-label="Dismiss notification" onClick={onClose}><X size={14} /></button></div> : null;
}

export function formatDate(value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  return new Intl.DateTimeFormat("en", options).format(new Date(value));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}