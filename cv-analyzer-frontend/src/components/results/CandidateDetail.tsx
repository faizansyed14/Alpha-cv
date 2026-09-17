'use client';

import { X, ArrowRight, Award, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  formatPercentage,
  getMatchQualityLabel,
} from '@/lib/utils';
import { CandidateBreakdown, AssignmentItem, AlternativesItem } from '@/lib/types';
import { useAppStore } from '@/stores/appStore';

interface CandidateDetailProps {
  candidate: CandidateBreakdown;
  onClose: () => void;
}

/** Semantic color by score (0-1). */
function scoreTone(score: number) {
  const pct = score * 100;
  if (pct >= 80) return { text: 'text-green-600', stroke: '#16a34a', badge: 'success' as const };
  if (pct >= 60) return { text: 'text-amber-500', stroke: '#f59e0b', badge: 'warning' as const };
  return { text: 'text-red-500', stroke: '#ef4444', badge: 'danger' as const };
}

/** Small SVG score ring. */
function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const tone = scoreTone(score);
  const r = 15.9155;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="-rotate-90" viewBox="0 0 36 36" width={size} height={size}>
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke="#f3f4f6"
          strokeWidth="3"
        />
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke={tone.stroke}
          strokeWidth="3"
          strokeDasharray={`${pct}, 100`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn('text-base font-semibold', tone.text)}>{pct}%</span>
      </div>
    </div>
  );
}

/** Thin labeled sub-score bar using the Progress primitive. */
function SubScoreBar({ label, score }: { label: string; score: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] text-gray-600">{label}</span>
        <span className={cn('text-[13px] font-semibold', scoreTone(score).text)}>{pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

export default function CandidateDetail({ candidate, onClose }: CandidateDetailProps) {
  const { matchResult } = useAppStore();

  const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  const getDisplayedBreakdown = () => {
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
  const displayed = getDisplayedBreakdown();

  // Get normalized weights from match result
  const weights = matchResult?.normalized_weights || {
    skills: 80,
    responsibilities: 15,
    job_title: 2.5,
    experience: 2.5,
  };

  // Convert weights to 0-1 scale
  const normalizedWeights = {
    skills: weights.skills / 100,
    responsibilities: weights.responsibilities / 100,
    job_title: weights.job_title / 100,
    experience: weights.experience / 100,
  };

  const renderAssignments = (assignments: AssignmentItem[], title: string) => {
    const avgScore = assignments.length > 0
      ? assignments.reduce((sum, a) => sum + a.score, 0) / assignments.length
      : 0;

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="section-label">{title} assignments ({assignments.length})</p>
          <div className="flex items-center gap-2 text-[13px] text-gray-500">
            <span>Average</span>
            <Badge variant={scoreTone(avgScore).badge}>{formatPercentage(avgScore)}</Badge>
          </div>
        </div>

        {assignments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-[13px] text-gray-500">
            No {title.toLowerCase()} assignments.
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH className="w-[40%]">JD requirement</TH>
                <TH className="w-[40%]">Matched CV item</TH>
                <TH className="w-[20%]">Similarity</TH>
              </TR>
            </THead>
            <TBody>
              {assignments.map((a, index) => (
                <TR key={index}>
                  <TD className="text-gray-900">{a.jd_item}</TD>
                  <TD>
                    <span className="flex items-start gap-1.5 text-gray-700">
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                      {a.cv_item}
                    </span>
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <span className={cn('font-semibold', scoreTone(a.score).text)}>
                        {formatPercentage(a.score)}
                      </span>
                      <Badge variant={scoreTone(a.score).badge}>{getMatchQualityLabel(a.score)}</Badge>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    );
  };

  const renderAlternatives = (alternatives: AlternativesItem[], title: string) => (
    <div className="space-y-3">
      <p className="section-label">{title} alternatives (top 3 per requirement)</p>
      {alternatives.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-[13px] text-gray-500">
          No alternatives available.
        </p>
      ) : (
        <div className="space-y-3">
          {alternatives.map((alt, jdIndex) => (
            <div key={jdIndex} className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <p className="mb-2 text-[13px] font-medium text-gray-900">Requirement {alt.jd_index}</p>
              <div className="space-y-1.5">
                {alt.items.map((item, itemIndex) => (
                  <div key={itemIndex} className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-1.5">
                    <span className="text-[13px] text-gray-700">{item.cv_item}</span>
                    <Badge variant={scoreTone(item.score).badge}>{formatPercentage(item.score)}</Badge>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const breakdownItems = [
    { label: 'Skills', score: displayed.scores.skills, weight: normalizedWeights.skills },
    { label: 'Responsibilities', score: displayed.scores.responsibilities, weight: normalizedWeights.responsibilities },
    { label: 'Job title', score: displayed.scores.title, weight: normalizedWeights.job_title },
    { label: 'Experience', score: displayed.scores.years, weight: normalizedWeights.experience },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-[0_8px_24px_rgba(16,24,40,0.12)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-4 min-w-0">
            <ScoreRing score={candidate.overall_score} />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-tight text-gray-900">{candidate.cv_name}</h2>
              <p className="mt-0.5 truncate text-[13px] text-gray-500">
                {candidate.cv_job_title || 'No title'} &middot; {candidate.cv_years} years experience
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <Badge variant="secondary">{displayed.sourceLabel}</Badge>
                {candidate.has_llm_analysis && (
                  <Badge variant="default"><Sparkles className="h-3 w-3" /> LLM verified</Badge>
                )}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-5">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="skills">Skills</TabsTrigger>
              <TabsTrigger value="responsibilities">Responsibilities</TabsTrigger>
              <TabsTrigger value="alternatives">Alternatives</TabsTrigger>
            </TabsList>

            {/* Overview */}
            <TabsContent value="overview" className="mt-5 space-y-5">
              {/* Breakdown */}
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <p className="section-label mb-4">Score breakdown</p>
                <div className="space-y-3.5">
                  {breakdownItems.map((item) => (
                    <SubScoreBar key={item.label} label={item.label} score={item.score} />
                  ))}
                </div>
              </div>

              {/* Weighted contribution */}
              <div className="rounded-lg border border-gray-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <div className="border-b border-gray-200 px-4 py-3">
                  <p className="section-label">Weighted contribution</p>
                </div>
                <Table>
                  <THead>
                    <TR>
                      <TH>Dimension</TH>
                      <TH>Score</TH>
                      <TH>Weight</TH>
                      <TH>Contribution</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {breakdownItems.map((item) => (
                      <TR key={item.label}>
                        <TD className="font-medium text-gray-900">{item.label}</TD>
                        <TD>{formatPercentage(item.score)}</TD>
                        <TD>{formatPercentage(item.weight)}</TD>
                        <TD className="font-semibold text-gray-900">{formatPercentage(item.score * item.weight)}</TD>
                      </TR>
                    ))}
                    <TR className="bg-gray-50/80">
                      <TD className="font-semibold text-gray-900" colSpan={3}>Overall score</TD>
                      <TD className={cn('font-semibold', scoreTone(candidate.overall_score).text)}>
                        {formatPercentage(candidate.overall_score)}
                      </TD>
                    </TR>
                  </TBody>
                </Table>
              </div>

              {/* Candidate profile */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                  <p className="section-label">Name</p>
                  <p className="mt-1 text-[13px] font-medium text-gray-900">{candidate.cv_name}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                  <p className="section-label">Current role</p>
                  <p className="mt-1 text-[13px] font-medium text-gray-900">{candidate.cv_job_title || 'Not specified'}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                  <p className="section-label">Experience</p>
                  <p className="mt-1 text-[13px] font-medium text-gray-900">{candidate.cv_years} years</p>
                </div>
              </div>

              {/* LLM analysis */}
              {candidate.has_llm_analysis && candidate.llm_analysis && (
                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                  <div className="mb-3 flex items-center gap-2">
                    <Award className="h-4 w-4 text-brand-600" />
                    <p className="section-label">AI analysis</p>
                  </div>
                  {candidate.llm_analysis.summary && (
                    <p className="text-[13px] leading-relaxed text-gray-700">{candidate.llm_analysis.summary}</p>
                  )}
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {Array.isArray(candidate.llm_analysis.key_matches) && candidate.llm_analysis.key_matches.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-[13px] font-medium text-green-600">Key matches</p>
                        <ul className="space-y-1">
                          {candidate.llm_analysis.key_matches.map((m: string, i: number) => (
                            <li key={i} className="flex gap-2 text-[13px] text-gray-700">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />{m}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(candidate.llm_analysis.gaps) && candidate.llm_analysis.gaps.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-[13px] font-medium text-red-500">Gaps</p>
                        <ul className="space-y-1">
                          {candidate.llm_analysis.gaps.map((g: string, i: number) => (
                            <li key={i} className="flex gap-2 text-[13px] text-gray-700">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />{g}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Skills */}
            <TabsContent value="skills" className="mt-5">
              {renderAssignments(candidate.skills_assignments, 'Skills')}
            </TabsContent>

            {/* Responsibilities */}
            <TabsContent value="responsibilities" className="mt-5">
              {renderAssignments(candidate.responsibilities_assignments, 'Responsibilities')}
            </TabsContent>

            {/* Alternatives */}
            <TabsContent value="alternatives" className="mt-5">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {renderAlternatives(candidate.skills_alternatives, 'Skills')}
                {renderAlternatives(candidate.responsibilities_alternatives, 'Responsibilities')}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
