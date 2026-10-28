'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import { COUNTRIES } from '@/lib/countries';
import { cn } from '@/lib/utils';

interface NationalityAutocompleteProps {
  /** Canonical country name — only ever set via picking a suggestion. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hasError?: boolean;
  className?: string;
}

const MAX_SUGGESTIONS = 8;

/**
 * Country picker for "Nationality" — client-side only (the ~250-country list
 * in lib/countries.ts is small and stable enough to bundle instead of
 * calling a backend endpoint like LocationAutocomplete does for cities).
 * Same selection-required behavior as LocationAutocomplete: typed text that
 * was never picked from the list reverts on blur, so the stored value is
 * always one of the same fixed country names — what makes it usable as a
 * clean Nationality filter later.
 */
export default function NationalityAutocomplete({
  value,
  onChange,
  placeholder = 'Start typing a country…',
  hasError,
  className,
}: NationalityAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery(value);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [value]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const starts = COUNTRIES.filter((c) => c.toLowerCase().startsWith(q));
    const contains = COUNTRIES.filter((c) => !c.toLowerCase().startsWith(q) && c.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [query]);

  const handleInputChange = (text: string) => {
    setQuery(text);
    setHighlightedIndex(-1);
    setIsOpen(text.trim().length > 0);
  };

  const selectCountry = (country: string) => {
    setQuery(country);
    onChange(country);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        selectCountry(suggestions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setQuery(value);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Flag className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.trim().length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          autoComplete="off"
          className={cn(className, '!pl-10')}
        />
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-[var(--shadow-md)]">
          {suggestions.map((country, i) => (
            <li key={country}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectCountry(country)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] ${
                  i === highlightedIndex ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Flag className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">{country}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
