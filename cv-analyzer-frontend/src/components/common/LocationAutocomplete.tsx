'use client';
import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface LocationSuggestion {
  city: string;
  country: string;
  label: string;
}

interface LocationAutocompleteProps {
  /** Canonical "City, Country" value — only ever set via picking a suggestion. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hasError?: boolean;
  className?: string;
}

/**
 * City/country picker backed by /api/careers/locations/search (a local,
 * bundled GeoNames dataset — no external API, no key, no rate limit).
 * Deliberately does NOT let the typed text itself become the value: only
 * clicking/selecting a suggestion commits a change, so whatever ends up
 * stored is always one of a fixed set of canonical "City, Country" strings.
 * That's what makes it usable as a location filter later (free text would
 * fragment into endless near-duplicate values).
 */
export default function LocationAutocomplete({
  value,
  onChange,
  placeholder = 'Start typing a city…',
  hasError,
  className,
}: LocationAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  // Keep the visible text in sync if the parent resets/changes value externally.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        // Typed something but never picked a suggestion — revert to the
        // last committed value instead of leaving free text in the field.
        setQuery(value);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [value]);

  const handleInputChange = (text: string) => {
    setQuery(text);
    setHighlightedIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = text.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const thisRequestId = ++requestIdRef.current;
      setLoading(true);
      try {
        const results = await api.searchLocations(trimmed);
        // Ignore stale responses from a since-superseded keystroke.
        if (thisRequestId !== requestIdRef.current) return;
        setSuggestions(results || []);
        setIsOpen(true);
      } catch {
        if (thisRequestId !== requestIdRef.current) return;
        setSuggestions([]);
      } finally {
        if (thisRequestId === requestIdRef.current) setLoading(false);
      }
    }, 300);
  };

  const selectSuggestion = (s: LocationSuggestion) => {
    setQuery(s.label);
    onChange(s.label);
    setSuggestions([]);
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
        selectSuggestion(suggestions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setQuery(value);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          autoComplete="off"
          // !pl-10 beats .field-input's px-3 so the MapPin never covers text
          className={cn(className, '!pl-10 !pr-8')}
        />
        {loading && (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-[var(--shadow-md)]">
          {suggestions.map((s, i) => (
            <li key={`${s.city}-${s.country}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectSuggestion(s)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] ${
                  i === highlightedIndex ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">
                  <span className="font-medium">{s.city}</span>
                  <span className="text-slate-500">, {s.country}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
