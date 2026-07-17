export interface TimeOption {
  value: string;
  label: string;
}

function buildTimeOptions(): TimeOption[] {
  const options: TimeOption[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const h24 = Math.floor(minutes / 60);
    const m = minutes % 60;
    const value = `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const ampm = h24 < 12 ? "AM" : "PM";
    const label = `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
    options.push({ value, label });
  }
  return options;
}

export const TIME_OPTIONS: TimeOption[] = buildTimeOptions();
