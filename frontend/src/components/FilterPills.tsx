interface PillOption<T extends string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  options: PillOption<T>[];
  active: T;
  onChange: (v: T) => void;
}

export default function FilterPills<T extends string>({ options, active, onChange }: Props<T>) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={[
            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            active === opt.key
              ? "bg-primary text-white"
              : "border border-border bg-panel text-text-secondary hover:border-border-strong hover:text-text-primary",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
