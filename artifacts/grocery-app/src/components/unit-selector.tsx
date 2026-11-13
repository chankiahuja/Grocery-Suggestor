import { forwardRef, useState } from "react";
import type { AriaAttributes } from "react";
import { INVENTORY_UNIT_OPTIONS } from "@/lib/inventory-units";

interface UnitSelectorProps {
  value: string;
  onChange: (value: string) => void;
  selectTestId: string;
  customInputTestId: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
}

export const UnitSelector = forwardRef<HTMLSelectElement, UnitSelectorProps>(({
  value,
  onChange,
  selectTestId,
  customInputTestId,
  disabled = false,
  invalid = false,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}, ref) => {
  const isPresetValue = INVENTORY_UNIT_OPTIONS.includes(
    value as (typeof INVENTORY_UNIT_OPTIONS)[number],
  );
  const [customMode, setCustomMode] = useState(!isPresetValue);

  return (
    <>
      <select
        ref={ref}
        id={id}
        value={customMode ? "Custom" : value}
        disabled={disabled}
        onChange={(event) => {
          const selected = event.target.value;
          const isCustom = selected === "Custom";
          setCustomMode(isCustom);
          onChange(isCustom ? "" : selected);
        }}
        aria-label="Unit"
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid ?? invalid}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-testid={selectTestId}
      >
        <option value="" disabled>Choose a unit</option>
        {INVENTORY_UNIT_OPTIONS.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
        <option value="Custom">Custom</option>
      </select>
      {customMode && (
        <input
          id={id ? `${id}-custom` : undefined}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter a custom text unit"
          aria-label="Custom unit"
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid ?? invalid}
          className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid={customInputTestId}
        />
      )}
    </>
  );
});
UnitSelector.displayName = "UnitSelector";
