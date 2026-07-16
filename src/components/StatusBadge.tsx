import { STATUS_LABELS, type ClientStatus } from "@/lib/types";

const STATUS_STYLES: Record<ClientStatus, string> = {
  NO_DISPO: "bg-border/60 text-muted-foreground",
  CALLBACK: "bg-gold/15 text-gold dark:bg-gold/20 dark:text-gold-bright",
  NOT_AVAILABLE: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  NOT_INTERESTED: "bg-border/40 text-muted-foreground/70",
  SOLD: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

export default function StatusBadge({ status }: { status: ClientStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
