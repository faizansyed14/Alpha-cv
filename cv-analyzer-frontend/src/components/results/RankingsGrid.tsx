// components/results/RankingsGrid.tsx
'use client';
import React, { useState, useEffect } from 'react';
import {
  Zap, Target, Users, Trophy, TrendingUp, Award, Sparkles, ChevronRight, Crown,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { PageHeader, EmptyState } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import CandidateDetail from './CandidateDetail';
import { formatPercentage } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { CandidateBreakdown } from '@/lib/types';

/** Semantic color by score (0-1). */
function scoreTone(score: number) {
  const pct = score * 100;
  if (pct >= 80) return { text: 'text-green-600', stroke: '#16a34a', badge: 'success' as const, label: 'Excellent' };
  if (pct >= 60) return { text: 'text-amber-500', stroke: '#f59e0b', badge: 'warning' as const, label: 'Good' };
  return { text: 'text-red-500', stroke: '#ef4444', badge: 'danger' as const, label: 'Needs review' };
}

/** Small SVG score ring. */
function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const tone = scoreTone(score);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="-rotate-90" viewBox="0 0 36 36" width={size} height={size}>
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none" stroke="#f3f4f6" strokeWidth="3"
        />
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none" stroke={tone.stroke} strokeWidth="3"
          strokeDasharray={`${pct}, 100`} strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn('text-[11px] font-semibold', tone.text)}>{pct}</span>
      </div>
    </div>
  );
}

/** Compact labeled mini-bar. */
function MiniBar({ label, score }: { label: string; score: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  return (
    <div className="min-w-[88px]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500">{label}</span>
        <span className="text-[11px] font-medium text-gray-700">{pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

export default function RankingsGrid() {
  const {
    jds,
    selectedJD,
    selectJD,
    matchResult,
    runMatch,
    loadingStates,
    loadJDs,
    selectedCVs,
    selectAllCVs,
  } = useAppStore();

  const [selectedCandidate, setSelectedCandidate] = useState<CandidateBreakdown | null>(null);
  const [sortBy, setSortBy] = useState<'overall' | 'skills' | 'responsibilities' | 'title' | 'experience'>('overall');
  const [filterThreshold, setFilterThreshold] = useState(0);

  useEffect(() => {
    if (jds.length === 0) {
      loadJDs();
    }
  }, [jds.length, loadJDs]);

  const isMatching = loadingStates.matching.isLoading;
  const matchError = loadingStates.matching.error;

  const handleRunMatch = async () => {
    if (!selectedJD) {
      alert('Please select a job description first');
      return;
    }

    if (selectedCVs.length === 0) {
      selectAllCVs();
    }

    await runMatch();
  };

  const candidates = matchResult?.candidates || [];

  const getSortedCandidates = () => {
    let filtered = candidates.filter(c => c.overall_score >= filterThreshold / 100);

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'skills': return b.skills_score - a.skills_score;
        case 'responsibilities': return b.responsibilities_score - a.responsibilities_score;
        case 'title': return b.job_title_score - a.job_title_score;
        case 'experience': return b.years_score - a.years_score;
        default: return b.overall_score - a.overall_score;
      }
    });
  };

  const sortedCandidates = getSortedCandidates();

  const analytics = {
    total: candidates.length,
    avgScore: candidates.length > 0 ? candidates.reduce((sum, c) => sum + c.overall_score, 0) / candidates.length : 0,
    bestScore: candidates.length > 0 ? Math.max(...candidates.map(c => c.overall_score)) : 0,
    qualifiedCandidates: candidates.filter(c => c.overall_score >= 0.7).length,
  };

  const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

  const getDisplayedBreakdown = (candidate: CandidateBreakdown) => {
    const raw = {
      skills: clamp01(candidate.skills_score || 0),
      responsibilities: clamp01(candidate.responsibilities_score || 0),
      title: clamp01(candidate.job_title_score || 0),
      years: clamp01(candidate.years_score || 0),
    };
    const hasLLM = !!candidate.has_llm_analysis && typeof (candidate as any).semantic_score === 'number';
    const semanticOverall = Number((candidate as any).semantic_score ?? 0);
    const overall = Number(candidate.overall_score ?? 0);
    if (hasLLM && semanticOverall > 0) {
      const scale = overall / semanticOverall;
      return {
        sourceLabel: 'LLM-adjusted',
        scores: {
          skills: clamp01(raw.skills * scale),
          responsibilities: clamp01(raw.responsibilities * scale),
          title: clamp01(raw.title * scale),
          years: clamp01(raw.years * scale),
        },
      };
    }
    return { sourceLabel: 'Similarity', scores: raw };
  };

  return (
    <div>
      <PageHeader
        title="Matching"
        description="Hungarian algorithm with explainable insights"
        actions={
          <Button
            variant="primary"
            icon={<Zap className="h-4 w-4" />}
            onClick={handleRunMatch}
            disabled={!selectedJD || isMatching}
            loading={isMatching}
          >
            {isMatching ? 'Analyzing…' : 'Run match'}
          </Button>
        }
      />

      {/* JD selection */}
      <p className="section-label mb-2">Select a job description</p>
      {jds.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No job descriptions available"
          hint="Upload a JD first to start matching."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {jds.map((jd) => {
            const active = selectedJD === jd.id;
            return (
              <button
                key={jd.id}
                onClick={() => selectJD(jd.id)}
                className={cn(
                  'rounded-lg border bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors',
                  active ? 'border-brand-400 ring-1 ring-brand-400' : 'border-gray-200 hover:border-brand-300'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate text-[13px] font-semibold text-gray-900">{jd.job_title}</h4>
                    <p className="mt-0.5 text-xs text-gray-500">{jd.years_of_experience} years required</p>
                  </div>
                  {active && <Badge variant="default">Active</Badge>}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{jd.skills_count} skills</Badge>
                  <Badge variant="secondary">{jd.responsibilities_count} resp.</Badge>
                </div>
                <p className="mt-2 truncate text-xs text-gray-400">{jd.filename}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Error */}
      {matchError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {matchError}
        </div>
      )}

      {/* Results */}
      {matchResult && (
        <>
          {/* KPIs */}
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Candidates" value={analytics.total} icon={Users} hint="Evaluated" />
            <StatCard label="Best match" value={formatPercentage(analytics.bestScore)} icon={Trophy} hint="Top score" />
            <StatCard label="Average" value={formatPercentage(analytics.avgScore)} icon={TrendingUp} hint="Across all" />
            <StatCard label="Qualified" value={analytics.qualifiedCandidates} icon={Award} hint="≥ 70% match" />
          </div>

          {/* Controls */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="h-9 rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              >
                <option value="overall">Sort by overall</option>
                <option value="skills">Sort by skills</option>
                <option value="responsibilities">Sort by responsibilities</option>
                <option value="title">Sort by job title</option>
                <option value="experience">Sort by experience</option>
              </select>
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-gray-500">Filter ≥</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={filterThreshold}
                  onChange={(e) => setFilterThreshold(parseInt(e.target.value))}
                  className="w-24 accent-brand-600"
                />
                <span className="min-w-[40px] text-[13px] font-medium text-gray-700">{filterThreshold}%</span>
              </div>
            </div>
            <span className="text-[13px] text-gray-500">
              {sortedCandidates.length} of {analytics.total} shown
            </span>
          </div>

          {/* Ranked table */}
          <p className="section-label mb-2 mt-6">Ranked candidates</p>
          {sortedCandidates.length === 0 ? (
            <EmptyState icon={Target} title="No candidates match the filter" hint="Lower the threshold to see more candidates." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-12">#</TH>
                  <TH className="w-16">Score</TH>
                  <TH>Candidate</TH>
                  <TH className="hidden lg:table-cell">Sub-scores</TH>
                  <TH className="w-28" />
                </TR>
              </THead>
              <TBody>
                {sortedCandidates.map((candidate, index) => {
                  const b = getDisplayedBreakdown(candidate);
                  const tone = scoreTone(candidate.overall_score);
                  return (
                    <TR
                      key={candidate.cv_id}
                      className="cursor-pointer"
                      onClick={() => setSelectedCandidate(candidate)}
                    >
                      <TD>
                        <span className="inline-flex items-center gap-1 font-semibold text-gray-900">
                          {index === 0 && <Crown className="h-4 w-4 text-amber-500" />}
                          {index + 1}
                        </span>
                      </TD>
                      <TD><ScoreRing score={candidate.overall_score} /></TD>
                      <TD>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium text-gray-900">
                              {candidate.cv_name || 'Unknown candidate'}
                            </span>
                            {candidate.has_llm_analysis && (
                              <Badge variant="default"><Sparkles className="h-3 w-3" /> LLM verified</Badge>
                            )}
                          </div>
                          <p className="truncate text-xs text-gray-500">
                            {candidate.cv_job_title || 'No title'} &middot; {candidate.cv_years} years
                          </p>
                          {/* Sub-scores on small screens */}
                          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 lg:hidden">
                            <MiniBar label="Skills" score={b.scores.skills} />
                            <MiniBar label="Resp." score={b.scores.responsibilities} />
                            <MiniBar label="Title" score={b.scores.title} />
                            <MiniBar label="Exp." score={b.scores.years} />
                          </div>
                        </div>
                      </TD>
                      <TD className="hidden lg:table-cell">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                          <MiniBar label="Skills" score={b.scores.skills} />
                          <MiniBar label="Resp." score={b.scores.responsibilities} />
                          <MiniBar label="Title" score={b.scores.title} />
                          <MiniBar label="Exp." score={b.scores.years} />
                        </div>
                      </TD>
                      <TD>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); setSelectedCandidate(candidate); }}
                        >
                          Details
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </>
      )}

      {/* Candidate Detail Modal */}
      {selectedCandidate && (
        <CandidateDetail
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
        />
      )}
    </div>
  );
}
