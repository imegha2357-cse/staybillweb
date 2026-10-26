import { RANGE_PRESETS, presetRange } from '../lib/dates';
import { Input, cx } from './ui';

/** Today / Yesterday / This week / This month / Custom (PRD §43). */
export default function DateRangeFilter({ value, onChange }) {
  const { preset, from, to } = value;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1">
        {RANGE_PRESETS.map((p) => (
          <button key={p.id} type="button"
            onClick={() => onChange(p.id === 'custom' ? { preset: 'custom', from, to } : { preset: p.id, ...presetRange(p.id) })}
            className={cx('rounded-md px-2.5 py-1 text-sm font-medium', preset === p.id ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Input type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => e.target.value && onChange({ preset, from: e.target.value, to })} aria-label="From" />
          to
          <Input type="date" className="h-9 w-40" value={to} min={from} onChange={(e) => e.target.value && onChange({ preset, from, to: e.target.value })} aria-label="To" />
        </div>
      )}
    </div>
  );
}

export function initialRange(preset = 'today') {
  return { preset, ...presetRange(preset) };
}
