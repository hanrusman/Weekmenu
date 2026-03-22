import { ShoppingItem as ShoppingItemType, safeJsonParse } from '../lib/api';

interface ShoppingItemProps {
  item: ShoppingItemType;
  onToggle: (checked: boolean) => void;
}

export default function ShoppingItem({ item, onToggle }: ShoppingItemProps) {
  const forDays = safeJsonParse<string[]>(item.for_days, []);

  return (
    <label className="flex items-center gap-3 py-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={!!item.checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="w-5 h-5 shrink-0 rounded border-gray-300 text-forest-500 focus:ring-forest-500"
      />
      <div className="flex-1 min-w-0">
        <div className={`${item.checked ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>
          {item.item_name}
          {item.quantity && <span className="text-sm text-gray-500 dark:text-gray-400 ml-1">({item.quantity})</span>}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-2">
          <span>{forDays.join(', ')}</span>
          {!!item.is_perishable && <span>vers</span>}
          {item.storage_tip && <span className="italic truncate">{item.storage_tip}</span>}
        </div>
      </div>
    </label>
  );
}
