import { PantryItem } from '../lib/api';

interface PantryCheckProps {
  item: PantryItem;
  onToggle: (have_it: boolean) => void;
}

export default function PantryCheck({ item, onToggle }: PantryCheckProps) {
  const neededDays = JSON.parse(item.needed_for_days || '[]') as string[];

  return (
    <label className="flex items-center gap-3 py-2 cursor-pointer">
      <input
        type="checkbox"
        checked={!!item.have_it}
        onChange={(e) => onToggle(e.target.checked)}
        className="w-5 h-5 rounded border-gray-300 text-forest-500 focus:ring-forest-500"
      />
      <div className="flex-1">
        <span className={item.have_it ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-gray-200'}>
          {item.item_name}
        </span>
        {item.have_it && <span className="text-xs text-green-600 ml-2">— in huis ✓</span>}
      </div>
      <span className="text-xs text-gray-500">({neededDays.join(', ')})</span>
    </label>
  );
}
