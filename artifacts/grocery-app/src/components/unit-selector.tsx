import { INVENTORY_UNIT_OPTIONS } from "@/lib/inventory-units";

interface UnitSelectorProps {
  value: string;
  onChange: (value: string) => void;
  selectTestId: string;
  customInputTestId: string;
  disabled?: boolean;
  invalid?: boolean;
}

export function UnitSelector({
  value,
  onChange,
  selectTestId,
  customInputTestId,
  disabled = false,
  invalid = false,
}: UnitSelectorProps) {
  const isPreset = INVENTORY_UNIT_OPTIONS.includes(
    value as (typeof INVENTORY_UNIT_OPTIONS)[number],
  );

  return (
    <>
      <select
        value={isPreset ? value : "Custom"}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === "Custom" ? "" : event.target.value)}
        aria-label="Unit"
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-testid={selectTestId}
      >
        <option value="" disabled>Choose a unit</option>
        {INVENTORY_UNIT_OPTIONS.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
        <option value="Custom">Custom</option>
      </select>
      {!isPreset && (
        <input
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter a custom text unit"
          aria-label="Custom unit"
          aria-invalid={invalid}
          className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid={customInputTestId}
        />
      )}
    </>
  );
}
