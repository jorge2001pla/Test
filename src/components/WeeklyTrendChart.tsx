export interface WeekPoint {
  label: string;
  count: number;
  isCurrent: boolean;
}

const CHART_HEIGHT = 100;
const BAR_WIDTH = 28;
const BAR_GAP = 14;
const TOP_PADDING = 20;

export default function WeeklyTrendChart({ weeks, goal }: { weeks: WeekPoint[]; goal: number }) {
  const maxValue = Math.max(goal, ...weeks.map((w) => w.count), 1);
  const plotHeight = CHART_HEIGHT;
  const width = weeks.length * (BAR_WIDTH + BAR_GAP);
  const goalY = TOP_PADDING + plotHeight - (goal / maxValue) * plotHeight;

  return (
    <div className="mt-4">
      <svg
        viewBox={`0 0 ${width} ${TOP_PADDING + plotHeight + 24}`}
        width="100%"
        height={TOP_PADDING + plotHeight + 24}
        role="img"
        aria-label={`Weekly new-client trend, goal ${goal}`}
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
        {weeks.map((w, i) => {
          const barHeight = (w.count / maxValue) * plotHeight;
          const x = i * (BAR_WIDTH + BAR_GAP);
          const y = TOP_PADDING + plotHeight - barHeight;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={BAR_WIDTH}
                height={Math.max(barHeight, 1)}
                rx={3}
                className={w.isCurrent ? "fill-gold/50 stroke-gold" : "fill-gold"}
                strokeWidth={w.isCurrent ? 1.5 : 0}
              />
              <text
                x={x + BAR_WIDTH / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize={11}
                className="fill-foreground font-medium"
              >
                {w.count}
              </text>
              <text
                x={x + BAR_WIDTH / 2}
                y={TOP_PADDING + plotHeight + 16}
                textAnchor="middle"
                fontSize={9}
                className="fill-muted-foreground"
              >
                {w.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-xs text-muted-foreground">
        Dashed line = weekly goal ({goal}). This week is still in progress.
      </p>
    </div>
  );
}
