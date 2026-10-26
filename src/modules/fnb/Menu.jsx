// Menu & recipes: items with price and GST, availability, and recipe costing
// from inventory items (cost, margin, food-cost %).
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Button, Input, Modal, Select, cx, useToast, useConfirm, errMsg } from '../../components/ui';
import { Icon } from '../../components/icons';
import { Chip, DataTable, FormFields, ModulePage, Stats, money, num, removeRecord, round2, saveRecord, useLive, validate } from '../kit';

export const CATEGORIES = ['Breakfast', 'Starters', 'Soups', 'Main course', 'Breads', 'Rice & biryani', 'Desserts', 'Beverages', 'Snacks', 'Room service', 'Other'];
const FIELDS = [
  { key: 'name', label: 'Item name', required: true, half: true, autoFocus: true },
  { key: 'category', label: 'Category', type: 'select', options: CATEGORIES, required: true, half: true },
  { key: 'price', label: 'Price (before GST)', type: 'money', required: true, half: true },
  { key: 'gst', label: 'GST %', type: 'number', step: '0.5', half: true, hint: 'Usually 5% for restaurant food.' },
  { key: 'veg', label: 'Food type', type: 'select', options: ['Veg', 'Non-veg', 'Egg', 'Vegan'], half: true, placeholder: false },
  { key: 'prepTime', label: 'Prep time (minutes)', type: 'number', half: true },
  { key: 'hsn', label: 'SAC / HSN code', half: true, placeholder: '996331' },
  { key: 'available', label: 'Available to order', type: 'toggle' },
  { key: 'description', label: 'Description', type: 'textarea' },
];
export const recipeCost = (recipe = [], stock = []) => round2(recipe.reduce((a, r) => a + num(r.qty) * num(stock.find((s) => s.id === r.itemId)?.costPrice), 0));

function MenuModal({ open, item, onClose, stock }) {
  const { user } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({});
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setV({ gst: 5, veg: 'Veg', available: true, recipe: [], ...item }); setErr({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const cost = recipeCost(v.recipe, stock);
  const price = num(v.price);
  async function save() {
    const e = validate(FIELDS, v); setErr(e); if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await saveRecord(user, 'menuItems', v.id, { ...v, price, gst: num(v.gst), prepTime: num(v.prepTime), cost, recipe: (v.recipe || []).filter((r) => r.itemId && num(r.qty) > 0).map((r) => ({ itemId: r.itemId, name: stock.find((s) => s.id === r.itemId)?.name || r.name, qty: num(r.qty), unit: stock.find((s) => s.id === r.itemId)?.unit || '' })) }, v.id ? 'MENU_UPDATED' : 'MENU_CREATED');
      toast(v.id ? 'Menu item saved' : `${v.name} added to the menu`); onClose();
    } catch (e2) { toast(errMsg(e2), 'error'); }
    setBusy(false);
  }
  const setLine = (i, patch) => setV({ ...v, recipe: v.recipe.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <Modal open={open} onClose={onClose} title={v.id ? v.name : 'New menu item'} icon="menu_book" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-space-md pb-space-sm">
        <FormFields fields={FIELDS} value={v} onChange={setV} errors={err} />
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">Recipe (per portion, from inventory)</span>
            <Button size="sm" variant="secondary" icon="add" onClick={() => setV({ ...v, recipe: [...(v.recipe || []), { itemId: '', qty: '' }] })}>Ingredient</Button>
          </div>
          {stock.length === 0 && <p className="text-label-md text-on-surface-variant">Add kitchen items in Inventory (with their cost price) to cost recipes and deduct stock when orders are served.</p>}
          {(v.recipe || []).map((r, i) => {
            const st = stock.find((s) => s.id === r.itemId);
            return (
              <div key={i} className="mb-1.5 grid grid-cols-[1fr_100px_110px_32px] items-center gap-2">
                <Select value={r.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}><option value="">Choose ingredient…</option>{stock.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}</Select>
                <Input type="number" min="0" step="any" placeholder="Qty" value={r.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                <span className="text-right text-body-md tabular-nums">{money(num(r.qty) * num(st?.costPrice))}</span>
                <button type="button" onClick={() => setV({ ...v, recipe: v.recipe.filter((_, j) => j !== i) })} className="text-on-surface-variant hover:text-error" aria-label="Remove ingredient"><Icon name="close" size={16} /></button>
              </div>
            );
          })}
          <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-surface-container-low p-3 text-body-md">
            <div><div className="text-label-sm text-on-surface-variant">Cost per portion</div><b>{money(cost)}</b></div>
            <div><div className="text-label-sm text-on-surface-variant">Margin</div><b className={price - cost < 0 ? 'text-error' : ''}>{money(price - cost)}</b></div>
            <div><div className="text-label-sm text-on-surface-variant">Food cost</div><b className={price && cost / price > 0.4 ? 'text-error' : ''}>{price ? `${Math.round((cost / price) * 100)}%` : '—'}</b></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function Menu() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const items = useLive('menuItems');
  const stock = useLive('stockItems') || [];
  const [edit, setEdit] = useState(null);
  const rows = useMemo(() => (items || []).map((m) => ({ ...m, liveCost: m.recipe?.length ? recipeCost(m.recipe, stock) : num(m.cost) })).sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name)), [items, stock]);
  const costed = rows.filter((r) => r.liveCost > 0);
  const avgFood = costed.length ? Math.round((costed.reduce((a, r) => a + r.liveCost / (r.price || 1), 0) / costed.length) * 100) : null;
  async function toggle(m) { try { await saveRecord(user, 'menuItems', m.id, { available: !m.available }); } catch (e) { toast(errMsg(e), 'error'); } }
  async function remove(m) { if (await confirm(`Remove ${m.name} from the menu?`, { confirmLabel: 'Remove' })) { await removeRecord(user, 'menuItems', m.id, 'MENU_DELETED'); toast('Removed'); } }
  return (
    <ModulePage crumb={['Restaurant', 'Menu & recipes']} title="Menu & recipes" subtitle="What the restaurant sells, and what it costs to make"
      actions={<Button icon="add" onClick={() => setEdit({})}>Add item</Button>}>
      <Stats items={[
        { label: 'Menu items', value: rows.length, icon: 'menu_book', sub: `${rows.filter((r) => r.available !== false).length} available now` },
        { label: 'Average food cost', value: avgFood === null ? '—' : `${avgFood}%`, icon: 'percent', tone: avgFood > 40 ? 'error' : undefined, sub: `${costed.length} items with recipes` },
        { label: 'Lowest margin', value: costed.length ? costed.reduce((m, r) => (r.price - r.liveCost < m.price - m.liveCost ? r : m)).name : '—', icon: 'trending_down', sub: costed.length ? money(Math.min(...costed.map((r) => r.price - r.liveCost))) : 'Add recipes to see' },
      ]} />
      <DataTable rows={items ? rows : null} onRow={(m) => setEdit(m)} search={(m) => `${m.name} ${m.category}`}
        filters={[{ id: 'all', label: 'All' }, ...CATEGORIES.filter((c) => rows.some((r) => r.category === c)).map((c) => ({ id: c, label: c, test: (r) => r.category === c }))]}
        empty="Add your dishes and drinks to start taking restaurant orders."
        columns={[
          { key: 'name', label: 'Item', render: (m) => <span className="flex items-center gap-2"><span className={cx('h-3 w-3 rounded-sm border-2', m.veg === 'Non-veg' ? 'border-red-600' : m.veg === 'Egg' ? 'border-amber-500' : 'border-green-600')} /><b>{m.name}</b></span> },
          { key: 'category', label: 'Category' },
          { key: 'price', label: 'Price', right: true, render: (m) => <>{money(m.price)}<div className="text-label-sm text-on-surface-variant">+{num(m.gst)}% GST</div></> },
          { key: 'cost', label: 'Cost', right: true, render: (m) => (m.liveCost ? money(m.liveCost) : '—') },
          { key: 'margin', label: 'Margin', right: true, render: (m) => (m.liveCost ? <span className={m.price - m.liveCost < 0 ? 'text-error' : ''}>{money(m.price - m.liveCost)} ({Math.round(((m.price - m.liveCost) / (m.price || 1)) * 100)}%)</span> : '—') },
          { key: 'av', label: 'Status', render: (m) => (m.available === false ? <Chip tone="error">86'd</Chip> : <Chip tone="ok">Available</Chip>) },
        ]}
        actions={(m) => <><Button size="sm" variant="ghost" onClick={() => toggle(m)}>{m.available === false ? 'Make available' : 'Mark sold out'}</Button><Button size="sm" variant="danger-ghost" icon="delete" onClick={() => remove(m)} aria-label="Remove" /></>} />
      <MenuModal open={!!edit} item={edit} stock={stock} onClose={() => setEdit(null)} />
    </ModulePage>
  );
}
