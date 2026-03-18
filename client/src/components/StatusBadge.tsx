interface StatusBadgeProps {
  status: string;
}

const statusConfig: Record<string, { label: string; classes: string }> = {
  draft: { label: 'Concept', classes: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  active: { label: 'Actief', classes: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  archived: { label: 'Archief', classes: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' },
  proposed: { label: 'Voorstel', classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  approved: { label: 'Goedgekeurd', classes: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  completed: { label: 'Klaar', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] || { label: status, classes: 'bg-gray-100 text-gray-700' };

  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${config.classes}`}>
      {config.label}
    </span>
  );
}
