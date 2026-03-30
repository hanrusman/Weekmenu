import { PantryItem, safeJsonParse } from '../lib/api';

interface PantryCheckProps {
  item: PantryItem;
  onToggle: (have_it: boolean) => void;
}

export default function PantryCheck({ item, onToggle }: PantryCheckProps) {
  const neededDays = safeJsonParse<string[]>(item.needed_for_days, []);

  return (
    <label className="flex items-center gap-3 py-3 cursor-pointer">
      <input
        type="checkbox"
        checked={!!item.have_it}
        onChange={(e) => onToggle(e.target.checked)}
        className="w-5 h-5 rounded-lg border-gray-300 text-warmth-500 focus:ring-warmth-400"
      />
      <div className="flex-1">
        <span className={item.have_it ? 'text-gray-400 line-through' : ''}>
          {item.item_name}
          {item.quantity && <span className="text-sm text-muted ml-1">({item.quantity})</span>}
        </span>
        {!!item.have_it && <span className="text-xs text-green-500 ml-2 font-medium">in huis</span>}
      </div>
      <span className="text-xs text-muted">({neededDays.join(', ')})</span>
    </label>
  );
}
