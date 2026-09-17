// components/results/WeightsPanel.tsx
'use client';
import { useState, useEffect } from 'react';
import { RotateCcw, Info, SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

const DIMENSIONS = [
  { key: 'skills', label: 'Skills matching', step: 5, hint: 'How CV skills match JD required skills (Hungarian algorithm)' },
  { key: 'responsibilities', label: 'Responsibilities matching', step: 5, hint: 'How CV responsibilities match JD required responsibilities' },
  { key: 'job_title', label: 'Job title similarity', step: 1, hint: 'Cosine similarity between CV job title and JD job title' },
  { key: 'experience', label: 'Experience ratio', step: 1, hint: 'Ratio rule: min(1.0, CV_years / JD_required_years)' },
] as const;

export default function WeightsPanel() {
  const { matchWeights, setMatchWeights } = useAppStore();

  // Default weights
  const defaultWeights = {
    skills: 80,
    responsibilities: 15,
    job_title: 2.5,
    experience: 2.5,
  };

  // Local state for slider values
  const [localWeights, setLocalWeights] = useState(defaultWeights);
  const [normalizedWeights, setNormalizedWeights] = useState(defaultWeights);

  // Update local weights when matchWeights change
  useEffect(() => {
    if (matchWeights) {
      setLocalWeights(matchWeights);
    }
  }, [matchWeights]);

  // Normalize weights to ensure they total 100%
  const normalizeWeights = (weights: typeof defaultWeights) => {
    const total = Object.values(weights).reduce((sum, val) => sum + val, 0);
    if (total <= 0) return defaultWeights;

    // Calculate the normalized weights
    const normalized = { ...weights };
    const keys = Object.keys(weights) as (keyof typeof weights)[];

    // If total is not 100, adjust proportionally
    if (total !== 100) {
      keys.forEach(key => {
        normalized[key] = (weights[key] / total) * 100;
      });
    }

    return normalized;
  };

  // Update normalized weights when local weights change
  useEffect(() => {
    const normalized = normalizeWeights(localWeights);
    setNormalizedWeights(normalized);
  }, [localWeights]);

  const handleWeightChange = (dimension: keyof typeof localWeights, value: number) => {
    const newWeights = { ...localWeights, [dimension]: value };
    setLocalWeights(newWeights);
    setMatchWeights(newWeights);
  };

  const resetToDefaults = () => {
    setLocalWeights(defaultWeights);
    setMatchWeights(defaultWeights);
  };

  const total = Object.values(localWeights).reduce((sum, val) => sum + val, 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50">
            <SlidersHorizontal className="h-4 w-4 text-brand-600" />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-gray-900">Matching weights</h3>
            <p className="text-xs text-gray-500">{total.toFixed(1)}% total &middot; normalized before matching</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={resetToDefaults}>
          Reset
        </Button>
      </div>

      <div className="space-y-5 p-4">
        {/* Info note */}
        <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50/60 px-3 py-2 text-[13px] text-gray-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <span>Weights are automatically normalized before matching. Higher weights give more importance to that dimension.</span>
        </div>

        {/* Sliders */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {DIMENSIONS.map((dim) => (
            <div key={dim.key} className="space-y-3 rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[13px] font-medium text-gray-900">{dim.label}</label>
                <span className="inline-flex min-w-[44px] justify-center rounded-md bg-brand-50 px-2 py-0.5 text-[12px] font-semibold text-brand-700">
                  {localWeights[dim.key]}%
                </span>
              </div>
              <Slider
                value={[localWeights[dim.key]]}
                min={0}
                max={100}
                step={dim.step}
                onValueChange={(v) => handleWeightChange(dim.key, v[0])}
              />
              <p className="text-xs text-gray-500">{dim.hint}</p>
            </div>
          ))}
        </div>

        {/* Normalized readout */}
        <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
          <p className="section-label mb-3">Normalized weights (total 100%)</p>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {DIMENSIONS.map((dim) => (
              <div key={dim.key} className="text-center">
                <div className="text-lg font-semibold text-gray-900">
                  {normalizedWeights[dim.key].toFixed(1)}%
                </div>
                <div className="text-xs text-gray-500">{dim.label.split(' ')[0]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
