import { ShoppingItem as ShoppingItemType, safeJsonParse } from '../lib/api';

interface ShoppingItemProps {
  item: ShoppingItemType;
  onToggle: (checked: boolean) => void;
}

export default function ShoppingItem({ item, onToggle }: ShoppingItemProps) {
  const forDays = safeJsonParse<string[]>(item.for_days, []);

  return (
    <label className="flex items-start gap-3 py-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={!!item.checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-1 w-5 h-5 rounded border-gray-300 text-forest-500 focus:ring-forest-500"
      />
      <div className="flex-1 min-w-0">
        <span className={`block ${item.checked ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>
          {item.item_name} {item.quantity && <span className="text-sm text-gray-500">({item.quantity})</span>}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {forDays.join(', ')}
          {item.is_perishable ? ' 🕐 vers' : ''}
        </span>
      </div>
      {item.storage_tip && (
        <span className="text-xs text-gray-400 hidden group-hover:block">{item.storage_tip}</span>
      )}
    </label>
  );
}
