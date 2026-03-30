import { ShoppingItem as ShoppingItemType, safeJsonParse } from '../lib/api';

interface ShoppingItemProps {
  item: ShoppingItemType;
  onToggle: (checked: boolean) => void;
}

export default function ShoppingItem({ item, onToggle }: ShoppingItemProps) {
  const forDays = safeJsonParse<string[]>(item.for_days, []);

  return (
    <label className="flex items-center gap-3 py-3 cursor-pointer">
      <input
        type="checkbox"
        checked={!!item.checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="w-5 h-5 shrink-0 rounded-lg border-gray-300 text-warmth-500 focus:ring-warmth-400"
      />
      <div className="flex-1 min-w-0">
        <div className={`${item.checked ? 'line-through text-gray-400' : ''}`}>
          {item.item_name}
          {item.quantity && <span className="text-sm text-muted ml-1">({item.quantity})</span>}
        </div>
        <div className="text-xs text-muted flex flex-wrap gap-x-2">
          <span>{forDays.join(', ')}</span>
          {!!item.is_perishable && <span>vers</span>}
          {item.storage_tip && <span className="italic truncate">{item.storage_tip}</span>}
        </div>
      </div>
    </label>
  );
}
