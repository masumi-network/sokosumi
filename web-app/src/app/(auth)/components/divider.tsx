interface DividerProps {
  label: string;
}

export default function Divider({ label }: DividerProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <hr className="h-0 flex-1 border-0 border-t border-gray-200" />
      <span className="text-xs text-gray-400 uppercase">{label}</span>
      <hr className="h-0 flex-1 border-0 border-t border-gray-200" />
    </div>
  );
}
