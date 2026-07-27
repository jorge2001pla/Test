export interface TrendPoint {
  label: string;
  /** Full period description (e.g. "Sat, Jul 25" or "Jul 23 – Jul 29") shown as a hover tooltip. */
  range: string;
  count: number;
  isCurrent: boolean;
}

const CHART_HEIGHT = 100;
const BAR_WIDTH = 28;
const BAR_GAP = 14;
const TOP_PADDING = 20;

export default function WeeklyTrendChart({
  points,
  goal,
  goalLabel,
  caption,
}: {
  points: TrendPoint[];
  goal: number;
  goalLabel: string;
  caption: string;
}) {
  const maxValue = Math.max(goal, ...points.map((p) => p.count), 1);
  const plotHeight = CHART_HEIGHT;
  const width = points.length * (BAR_WIDTH + BAR_GAP);
  const goalY = TOP_PADDING + plotHeight - (goal / maxValue) * plotHeight;

  return (
    <div className="mt-4">
      <svg
        viewBox={`0 0 ${width} ${TOP_PADDING + plotHeight + 24}`}
        width="100%"
        height={TOP_PADDING + plotHeight + 24}
        role="img"
        aria-label={goalLabel}
      >
        <line
          x1={0}
          y1={goalY}
          x2={width}
          y2={goalY}
          stroke="currentColor"
          strokeDasharray="4 3"
          strokeWidth={1}
          className="text-muted-foreground"
        />
        {points.map((p, i) => {
          const barHeight = (p.count / maxValue) * plotHeight;
          const x = i * (BAR_WIDTH + BAR_GAP);
          const y = TOP_PADDING + plotHeight - barHeight;
          return (
            <g key={i}>
              <title>{`${p.range}: ${p.count} new client${p.count === 1 ? "" : "s"}`}</title>
              <rect
                x={x}
                y={y}
                width={BAR_WIDTH}
                height={Math.max(barHeight, 1)}
                rx={3}
                className={p.isCurrent ? "fill-gold/50 stroke-gold" : "fill-gold"}
                strokeWidth={p.isCurrent ? 1.5 : 0}
              />
              <text
                x={x + BAR_WIDTH / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize={11}
                className="fill-foreground font-medium"
              >
                {p.count}
              </text>
              <text
                x={x + BAR_WIDTH / 2}
                y={TOP_PADDING + plotHeight + 16}
                textAnchor="middle"
                fontSize={9}
                className={p.isCurrent ? "fill-gold font-medium" : "fill-muted-foreground"}
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}
