// Batch print: renders several stored invoices, one per A4 page, and opens the print dialog.
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getBill, paymentsForBill } from '../lib/db';
import { useData } from '../context/DataContext';
import InvoiceView from '../components/InvoiceView';
import { downloadInvoicesPdf } from '../lib/pdf';
import { CAN_PRINT } from '../platform';
import { Button, Loading, PageHeader, useToast, errMsg } from '../components/ui';
import { Icon } from '../components/icons';

export default function BatchPrint() {
  const [params] = useSearchParams();
  const { settings } = useData();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const printed = useRef(false);
  const ids = (params.get('ids') || '').split(',').filter(Boolean);

  useEffect(() => {
    Promise.all(ids.map(async (id) => {
      const bill = await getBill(id);
      return bill ? { bill, payments: await paymentsForBill(id) } : null;
    }))
      .then((r) => setItems(r.filter(Boolean)))
      .catch((e) => { toast(errMsg(e), 'error'); setItems([]); });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (items?.length && CAN_PRINT && !printed.current) {
      const t = setTimeout(() => { printed.current = true; window.print(); }, 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [items]);

  if (!items) return <Loading label="Preparing invoices…" />;
  return (
    <div>
      <div className="no-print">
        <PageHeader crumbs={['Billing', 'Batch Print']} title={`Print ${items.length} invoice${items.length === 1 ? '' : 's'}`}
          back={<Link to="/bills" className="mb-1 inline-flex items-center gap-1 text-label-md text-on-surface-variant hover:text-on-surface"><Icon name="arrow_back" size={14} />Bills &amp; Payments</Link>}
          actions={CAN_PRINT ? <Button icon="print" onClick={() => window.print()}>Print again</Button>
            : <Button icon="picture_as_pdf" onClick={() => downloadInvoicesPdf(items, settings)}>Download PDF</Button>} />
      </div>
      <div className="print-area space-y-6">
        {items.map(({ bill, payments }, i) => (
          <div key={bill.id} className={i < items.length - 1 ? 'page-break' : ''}>
            <div className="overflow-x-auto"><div className="min-w-[640px]"><InvoiceView bill={bill} settings={settings} payments={payments} /></div></div>
          </div>
        ))}
      </div>
    </div>
  );
}
