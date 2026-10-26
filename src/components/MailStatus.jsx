import { Badge } from './ui';

/** Status chip for one guest email. */
export default function MailStatus({ m }) {
  if (m.status === 'sent') return <Badge tone="green">Sent</Badge>;
  if (m.status === 'error') return <span title={m.error || ''}><Badge tone="red">Failed</Badge></span>;
  if (m.status === 'skipped') return <span title={m.reason || ''}><Badge>Skipped{m.reason ? `: ${m.reason}` : ''}</Badge></span>;
  return <Badge tone="blue">Waiting</Badge>;
}
