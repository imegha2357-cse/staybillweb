// Header popover: theme, motion level and welcome-page preference (saved per device).
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppearance } from '../context/AppearanceContext';
import { Icon } from './icons';
import { cx, Toggle } from './ui';

function Segmented({ value, onChange, options, label }) {
  return (
    <div>
      <div className="mb-1 text-label-sm uppercase tracking-wider text-on-surface-variant">{label}</div>
      <div className="grid gap-1 rounded-lg bg-surface-container-low p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
            className={cx('flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 text-label-md transition-colors',
              value === o.value ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant hover:text-on-surface')}>
            <Icon name={o.icon} size={16} />{o.label}
          </button>
        ))}
      </div>
      {options.find((o) => o.value === value)?.hint && <p className="mt-1 text-label-sm text-on-surface-variant">{options.find((o) => o.value === value).hint}</p>}
    </div>
  );
}

export default function AppearanceMenu() {
  const a = useAppearance();
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Appearance" title="Appearance: theme and animations"
        className="rounded-lg p-space-sm text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface">
        <Icon name="palette" size={20} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.18 }}
            className="absolute right-0 top-full z-50 mt-2 max-h-[calc(100vh-88px)] w-72 space-y-space-md overflow-y-auto rounded-xl bg-surface-container-lowest p-space-md shadow-xl ring-1 ring-outline-variant/30">
            <div className="flex items-center gap-space-xs">
              <Icon name="palette" size={18} className="text-secondary" />
              <h3 className="font-headline text-headline-sm text-on-surface">Appearance</h3>
            </div>
            <Segmented label="Theme" value={a.theme} onChange={a.setTheme} options={[
              { value: 'light', label: 'Light', icon: 'light_mode', hint: 'Clean Stitch design.' },
              { value: 'dark', label: 'Night', icon: 'dark_mode', hint: 'Deep night look with glowing brand colours and a starry sky.' },
            ]} />
            <Segmented label="Animations" value={a.motionSetting} onChange={a.setMotion} options={[
              { value: 'off', label: 'Off', icon: 'motion_photos_off', hint: 'No animation. Fastest.' },
              { value: 'light', label: 'Light', icon: 'animation', hint: 'Smooth page changes, count-up totals, soft fade-ins.' },
              { value: 'full', label: 'Full', icon: 'auto_awesome', hint: 'Adds blur-in reveals, glowing cursor trail and shooting stars.' },
            ]} />
            {a.motionSetting !== 'off' && (
              <Segmented label="Page change" value={a.transition} onChange={a.setTransition} options={[
                { value: 'elevator', label: 'Elevator', icon: 'elevator', hint: 'Lift doors open onto each page, with the floor number.' },
                { value: 'fade', label: 'Fade', icon: 'blur_on', hint: 'A quick soft fade between pages.' },
              ]} />
            )}
            <div className="border-t border-surface-container pt-1">
              <Toggle label="Concierge bell sound" description="A soft ding when a bill or payment is saved."
                checked={a.sound} onChange={a.setSound} />
            </div>
            <p className="text-label-sm text-on-surface-variant">Saved on this device only.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
