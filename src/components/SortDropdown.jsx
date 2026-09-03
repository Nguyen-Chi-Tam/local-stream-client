import React from 'react';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
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
            sideOffset={6}
            className="sort-dropdown-content"
          >
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <DropdownMenuItem
                  key={opt.value}
                  className={`sort-dropdown-item${isSelected ? ' selected' : ''}`}
                  onClick={() => handleValueChange(opt.value)}
                >
                  <span className="sort-dropdown-item-label">{opt.label}</span>
                  {isSelected && <span className="sort-dropdown-dot" aria-hidden="true" />}
                </DropdownMenuItem>
              );
            })}
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

