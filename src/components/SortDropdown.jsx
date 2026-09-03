import React from 'react';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from './ui/dropdown-menu.jsx';
import { NativeSelect, NativeSelectOption } from './ui/native-select.jsx';

export default function SortDropdown({
  id = 'sort-select',
  value,
  onChange,
  options = [
    { value: 'date', label: 'Date' },
    { value: 'name', label: 'Name' },
    { value: 'duration', label: 'Duration' },
  ],
  ariaLabel = 'Sort options',
  style,
  className = '',
}) {
  const currentOption = options.find((opt) => opt.value === value) || options[0] || { value: '', label: '' };

  const handleValueChange = (newVal) => {
    if (onChange) {
      onChange({ target: { value: newVal } }, newVal);
    }
  };

  return (
    <>
      {/* Desktop Screen Size: Custom Dropdown Menu */}
      <div className={`desktop-only ${className}`} style={style}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              id={id ? `${id}-trigger` : undefined}
              className="sort-dropdown-trigger"
              aria-label={ariaLabel}
            >
              <span className="sort-dropdown-value">{currentOption.label}</span>
              <ChevronDown size={14} className="sort-dropdown-chevron" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-[7.5rem] bg-slate-900/95 backdrop-blur-md border border-slate-700/80 shadow-2xl p-1 rounded-xl z-[99999]"
          >
            <DropdownMenuRadioGroup value={value} onValueChange={handleValueChange}>
              {options.map((opt) => (
                <DropdownMenuRadioItem
                  key={opt.value}
                  value={opt.value}
                  className="cursor-pointer hover:bg-slate-800/90 gap-2 text-xs py-1.5 px-2.5 rounded-lg focus:bg-slate-800 focus:text-sky-400 transition-colors font-medium text-slate-200 data-[state=checked]:text-sky-400 data-[state=checked]:font-semibold"
                >
                  {opt.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile Screen Size: Native Select Combobox */}
      <div className={`mobile-only ${className}`} style={style}>
        <NativeSelect
          id={id}
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => handleValueChange(e.target.value)}
          style={style}
        >
          {options.map((opt) => (
            <NativeSelectOption key={opt.value} value={opt.value}>
              {opt.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </>
  );
}

