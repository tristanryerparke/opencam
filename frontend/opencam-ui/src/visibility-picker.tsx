type Visibility = { stock: boolean; part: boolean; toolpath: boolean; tool: boolean };

type Props = {
  value: Visibility;
  toolEnabled: boolean;
  expand?: boolean;
  onChange: (key: keyof Visibility, value: boolean) => void;
  className?: string;
};

export function VisibilityPicker({ value, toolEnabled, expand = false, onChange, className }: Props) {
  const items: { key: keyof Visibility; label: string }[] = [
    { key: "stock", label: "Stock" },
    { key: "part", label: "Part" },
    { key: "toolpath", label: "Toolpaths" },
    { key: "tool", label: "Tool" },
  ];
  return <div role="group" className={className} data-slot="visibility-picker" onClick={(event) => event.stopPropagation()} style={{ display: "flex", width: expand ? "100%" : "fit-content", maxWidth: "100%", minWidth: 0, alignItems: "center", gap: 0 }}>
    {items.map(({ key, label }, index) => {
      const disabled = key === "tool" && !toolEnabled;
      const active = value[key] && !disabled;
      const isFirst = index === 0;
      const isLast = index === items.length - 1;
      return <button key={key} type="button" disabled={disabled} aria-pressed={value[key]} data-state={active ? "on" : "off"} onClick={(event) => { event.stopPropagation(); if (!disabled) onChange(key, !value[key]); }} style={{ minWidth: "max-content", height: "1.75rem", flex: expand ? "1 1 0" : "0 1 auto", paddingInline: "0.5rem", whiteSpace: "nowrap", border: "1px solid var(--border)", borderLeftWidth: isFirst ? 1 : 0, borderTopLeftRadius: isFirst ? "calc(var(--radius, 0.5rem) - 2px)" : 0, borderBottomLeftRadius: isFirst ? "calc(var(--radius, 0.5rem) - 2px)" : 0, borderTopRightRadius: isLast ? "calc(var(--radius, 0.5rem) - 2px)" : 0, borderBottomRightRadius: isLast ? "calc(var(--radius, 0.5rem) - 2px)" : 0, background: active ? "color-mix(in srgb, var(--foreground) 15%, transparent)" : "transparent", color: "var(--foreground)", fontSize: "0.75rem", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.3 : active ? 1 : 0.45 }}>{label}</button>;
    })}
  </div>;
}
