'use client';

import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { statusColor } from '../utils';

export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  );
}

export function FormInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="bg-white text-slate-900 placeholder:text-slate-400 border-slate-300 focus:border-brand-500 focus:ring-brand-500"
    />
  );
}

export function DatePicker({ value, onChange, label, min, max }: { value: string; onChange: (v: string) => void; label?: string; min?: string; max?: string }) {
  return (
    <div className="relative">
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        min={min}
        max={max}
        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 [color-scheme:light]"
      />
    </div>
  );
}

export function StatusBadge({ label }: { label: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border whitespace-nowrap ${statusColor(label)}`}>
      {label}
    </span>
  );
}
