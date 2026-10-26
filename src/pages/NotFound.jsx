// 404 and "no access" screens with the door animation (motion pick 30).
import { Link } from 'react-router-dom';
import { DoorScene } from '../motion/hotel';
import { Icon } from '../components/icons';

export default function NotFound({ locked = false }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-10 text-center">
      <DoorScene locked={locked} label={locked ? 'STAFF' : '404'} />
      <h1 className="mt-2 font-headline text-headline-lg tracking-tight text-on-surface">{locked ? 'This room is staff only' : 'This page has checked out'}</h1>
      <p className="mt-1 max-w-md text-body-md text-on-surface-variant">
        {locked ? 'Your account does not have access to this part of StayBill. Ask an administrator if you need it.' : 'The link may be old or mistyped. Everything else is where you left it.'}
      </p>
      <Link to="/" className="mt-space-md inline-flex items-center gap-1 rounded-lg bg-primary px-space-md py-space-sm text-label-lg text-on-primary shadow-sm hover:bg-primary-container">
        <Icon name="concierge" size={16} />Back to the front desk
      </Link>
    </div>
  );
}
