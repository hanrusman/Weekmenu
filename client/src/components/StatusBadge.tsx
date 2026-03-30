interface StatusBadgeProps {
  status: string;
}

const statusConfig: Record<string, { label: string; classes: string }> = {
  active: { label: 'Actief', classes: 'bg-green-50 text-green-600' },
  archived: { label: 'Archief', classes: 'bg-gray-100 text-muted' },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] || { label: status, classes: 'bg-gray-100 text-muted' };

  return (
    <span className={`inline-block text-[10px] font-bold px-3 py-1 rounded-full tracking-wide uppercase ${config.classes}`}>
      {config.label}
    </span>
  );
}
