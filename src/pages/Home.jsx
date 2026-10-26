// StayBill home: one continuous page. The animated night-city hero opens it,
// the live front desk (today's figures, check-outs due, recent bills) follows,
// and the features, how-it-works, gallery and closing sections continue below,
// all inside the normal app shell.
import { useNavigate } from 'react-router-dom';
import { useAppearance } from '../context/AppearanceContext';
import { useData } from '../context/DataContext';
import { Icon } from '../components/icons';
import Dashboard from './Dashboard';
import { Closing, Features, Hero, HowItWorks, NightBand, Pillars } from './Welcome';
import { ripple } from '../motion/hotel';
import './welcome.css';

const SECTIONS = [['today', 'Front desk', 'concierge'], ['features', 'Features', 'auto_awesome'], ['how', 'How it works', 'route']];

export default function Home() {
  const nav = useNavigate();
  const { motion: level } = useAppearance();
  const { settings, can } = useData();
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: level === 'off' ? 'auto' : 'smooth', block: 'start' });
  const newBill = { label: 'Create a new bill', icon: 'receipt_long', onClick: () => nav('/bills/new') };

  return (
    <div className="flex flex-col gap-space-lg">
      <NightBand className="-mt-2 rounded-3xl shadow-sm">
        <Hero compact hotel={settings.hotelName} primary={newBill} secondary={{ label: "Today's front desk", onClick: () => go('today') }} />
      </NightBand>

      <nav aria-label="On this page" className="no-print -mb-2 flex flex-wrap gap-2">
        {SECTIONS.map(([id, label, icon]) => (
          <button key={id} type="button" onClick={() => go(id)} onPointerDown={ripple}
            className="relative isolate flex items-center gap-1.5 overflow-hidden rounded-full bg-surface-container-lowest px-space-md py-1.5 text-label-lg text-on-surface-variant shadow-sm transition-colors hover:text-on-surface">
            <Icon name={icon} size={16} className="text-secondary" />{label}
          </button>
        ))}
      </nav>

      <section id="today" className="scroll-mt-20">
        <Dashboard />
      </section>

      <NightBand className="rounded-3xl shadow-sm">
        <Features cta={(
          <button type="button" onClick={() => nav('/bills/new')} className="wl-btn flex shrink-0 items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold text-white">
            Start a bill <Icon name="arrow_forward" size={14} />
          </button>
        )} />
        <HowItWorks motionLevel={level} stickyTop={64} cta={(
          <button type="button" onClick={() => nav('/bills/new')} className="wl-btn mt-8 flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold text-white">
            Try it now <Icon name="arrow_forward" size={14} />
          </button>
        )} />
        <Pillars />
        <Closing action={newBill} hotel={settings.hotelName}
          links={[['Front desk', () => go('today')], ['Features', () => go('features')], ['How it works', () => go('how')]]} />
      </NightBand>
    </div>
  );
}
