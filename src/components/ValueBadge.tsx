import { valueTier, VALUE_TIER_LABELS } from "@/lib/business-logic";
import { formatWholeCurrency } from "@/lib/format";

const TIER_STYLES: Record<string, string> = {
  whale: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  wahoo: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  snapper: "bg-gold/15 text-gold dark:text-gold-bright",
};

export default function ValueBadge({ value }: { value: number }) {
  const tier = valueTier(value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{formatWholeCurrency(value)}</span>
      {tier && (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TIER_STYLES[tier]}`}
        >
          {VALUE_TIER_LABELS[tier]}
        </span>
      )}
    </span>
  );
}
