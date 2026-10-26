// Material Symbols icons (as used in the Stitch design), exposed under the
// names the pages already import. Size comes from Tailwind h-* classes.

export function Icon({ name, className = '', size, fill, style, ...rest }) {
  let px = size;
  if (!px) {
    const m = className.match(/(?:^|\s)h-(\d+(?:\.\d+)?)(?=\s|$)/) || className.match(/(?:^|\s)h-\[(\d+)px\]/);
    if (m) px = className.includes(`h-[${m[1]}px]`) ? Number(m[1]) : Number(m[1]) * 4;
  }
  const cls = className.replace(/(?:^|\s)[hw]-(?:\d+(?:\.\d+)?|\[\d+px\])(?=\s|$)/g, ' ').trim();
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined select-none leading-none ${cls}`}
      style={{ fontSize: px ? `${Math.round(px * 1.15)}px` : undefined, fontVariationSettings: fill ? "'FILL' 1" : undefined, ...style }}
      {...rest}
    >
      {name}
    </span>
  );
}

const make = (name) => {
  const C = (props) => <Icon name={name} {...props} />;
  C.displayName = name;
  return C;
};

export const LayoutDashboard = make('grid_view');
export const Receipt = make('receipt_long');
export const Users = make('hotel');
export const BedDouble = make('meeting_room');
export const Wallet = make('payments');
export const BarChart3 = make('bar_chart');
export const Settings = make('tune');
export const LogOut = make('logout');
export const Menu = make('menu');
export const X = make('close');
export const Plus = make('add');
export const Search = make('search');
export const UserCheck = make('how_to_reg');
export const UserPlus = make('person_add');
export const Download = make('file_download');
export const ArrowLeft = make('arrow_back');
export const ArrowRight = make('arrow_forward');
export const Trash2 = make('delete');
export const Loader2 = make('progress_activity');
export const CheckCircle2 = make('check_circle');
export const AlertCircle = make('error');
export const Printer = make('print');
export const Share2 = make('share');
export const Pencil = make('edit');
export const Ban = make('block');
export const Upload = make('upload');
export const KeyRound = make('key');
export const FileText = make('picture_as_pdf');
export const FileSpreadsheet = make('table_view');
