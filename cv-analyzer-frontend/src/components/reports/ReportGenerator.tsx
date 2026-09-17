'use client';

import React, { useState } from 'react';
import {
  FileDown,
  Users,
  BarChart3,
  Filter,
  TrendingUp,
  Target,
  Award,
  CheckCircle,
  AlertCircle,
  Share2,
  Mail,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { PageHeader } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { useAppStore } from '@/stores/appStore';
import { formatPercentage } from '@/lib/utils';

interface ReportConfig {
  type: 'detailed' | 'summary' | 'executive';
  includeCharts: boolean;
  includeAssignments: boolean;
  includeAlternatives: boolean;
  dateRange: 'all' | 'last_week' | 'last_month';
}

export default function ReportGenerator() {
  const { cvs, jds, matchResult, systemHealth } = useAppStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [config, setConfig] = useState<ReportConfig>({
    type: 'detailed',
    includeCharts: true,
    includeAssignments: true,
    includeAlternatives: false,
    dateRange: 'all'
  });

  const generatePDFReport = async () => {
    setIsGenerating(true);

    try {
      // Simulate PDF generation
      await new Promise(resolve => setTimeout(resolve, 3000));

      // In a real implementation, this would generate and download a PDF
      const reportData = generateReportData();
      const blob = new Blob([JSON.stringify(reportData, null, 2)], {
        type: 'application/json'
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cv-matching-report-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error('Report generation failed:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const generateReportData = () => {
    const totalCandidates = cvs.length;
    const totalJobs = jds.length;
    const totalMatches = matchResult?.candidates.length || 0;

    const highQualityMatches = matchResult?.candidates?.filter(c =>
      c.overall_score >= 0.7
    ).length || 0;

    const averageScore = (matchResult?.candidates?.reduce((sum, c) =>
      sum + c.overall_score, 0
    ) || 0) / (totalMatches || 1);

    return {
      metadata: {
        generated_at: new Date().toISOString(),
        report_type: config.type,
        date_range: config.dateRange,
      },
      summary: {
        total_candidates: totalCandidates,
        total_jobs: totalJobs,
        total_matches: totalMatches,
        high_quality_matches: highQualityMatches,
        average_score: averageScore,
        system_health: systemHealth?.status || 'unknown',
      },
      detailed_results: config.type === 'detailed' ? {
        candidates: matchResult?.candidates || [],
        include_assignments: config.includeAssignments,
        include_alternatives: config.includeAlternatives,
      } : undefined,
      insights: {
        top_skills_demand: extractTopSkills(),
        best_matches: matchResult?.candidates?.slice(0, 5) || [],
        improvement_areas: generateInsights(),
      }
    };
  };

  const extractTopSkills = () => {
    if (!jds.length) return [];

    // Mock implementation - in real scenario, extract from JD data
    return [
      { skill: 'Python', demand: 85 },
      { skill: 'React', demand: 78 },
      { skill: 'Machine Learning', demand: 72 },
      { skill: 'AWS', demand: 65 },
      { skill: 'SQL', demand: 60 },
    ];
  };

  const generateInsights = () => {
    const insights = [];

    if (matchResult && matchResult.candidates && matchResult.candidates.length > 0) {
      const avgScore = matchResult.candidates.reduce((sum, c) => sum + c.overall_score, 0) / matchResult.candidates.length;

      if (avgScore < 0.5) {
        insights.push({
          type: 'warning',
          title: 'Low Average Match Score',
          description: 'Consider expanding search criteria or reviewing job requirements',
          impact: 'High'
        });
      }

      if (matchResult.candidates.filter(c => c.overall_score >= 0.8).length === 0) {
        insights.push({
          type: 'info',
          title: 'No Excellent Matches Found',
          description: 'Consider skills training programs or broader candidate sourcing',
          impact: 'Medium'
        });
      }
    }

    return insights;
  };

  const totalCandidates = cvs.length;
  const totalJobs = jds.length;
  const totalMatches = matchResult?.candidates.length || 0;
  const highQualityMatches = matchResult?.candidates?.filter(c => c.overall_score >= 0.7).length || 0;

  return (
    <div>
      <PageHeader
        title="Analytics & Reports"
        description="Generate comprehensive matching reports and insights"
        actions={
          <>
            <Button variant="secondary" icon={<Share2 className="h-4 w-4" />}>
              Share
            </Button>
            <Button variant="secondary" icon={<Mail className="h-4 w-4" />}>
              Email
            </Button>
          </>
        }
      />

      {/* Key metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Candidates"
          value={totalCandidates.toString()}
          icon={Users}
          hint="CVs processed"
        />
        <StatCard
          label="Active Positions"
          value={totalJobs.toString()}
          icon={Target}
          hint="Job descriptions"
        />
        <StatCard
          label="Successful Matches"
          value={totalMatches.toString()}
          icon={BarChart3}
          hint="AI-powered matches"
        />
        <StatCard
          label="Quality Rate"
          value={totalMatches > 0 ? formatPercentage(highQualityMatches / totalMatches) : '0%'}
          icon={Award}
          hint="High-quality matches"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Report Configuration */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-brand-600" />
                Report Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-6">
                {/* Report Type */}
                <div>
                  <label className="mb-2 block text-[13px] font-medium text-gray-700">
                    Report Type
                  </label>
                  <div className="space-y-2">
                    {(['summary', 'detailed', 'executive'] as const).map((type) => (
                      <label key={type} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="reportType"
                          value={type}
                          checked={config.type === type}
                          onChange={(e) => setConfig(prev => ({ ...prev, type: e.target.value as any }))}
                          className="h-4 w-4 border-gray-300 text-brand-600 focus:ring-brand-500/30"
                        />
                        <span className="text-[13px] capitalize text-gray-700">{type} Report</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Include Options */}
                <div>
                  <label className="mb-2 block text-[13px] font-medium text-gray-700">
                    Include in Report
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={config.includeCharts}
                        onChange={(e) => setConfig(prev => ({ ...prev, includeCharts: e.target.checked }))}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
                      />
                      <span className="text-[13px] text-gray-700">Charts &amp; Visualizations</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={config.includeAssignments}
                        onChange={(e) => setConfig(prev => ({ ...prev, includeAssignments: e.target.checked }))}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
                      />
                      <span className="text-[13px] text-gray-700">Detailed Assignments</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={config.includeAlternatives}
                        onChange={(e) => setConfig(prev => ({ ...prev, includeAlternatives: e.target.checked }))}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
                      />
                      <span className="text-[13px] text-gray-700">Alternative Matches</span>
                    </label>
                  </div>
                </div>

                {/* Date Range */}
                <div>
                  <label className="mb-2 block text-[13px] font-medium text-gray-700">
                    Date Range
                  </label>
                  <select
                    value={config.dateRange}
                    onChange={(e) => setConfig(prev => ({ ...prev, dateRange: e.target.value as any }))}
                    className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-900 shadow-sm focus:outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30"
                  >
                    <option value="all">All Time</option>
                    <option value="last_week">Last Week</option>
                    <option value="last_month">Last Month</option>
                  </select>
                </div>

                {/* Generate Button */}
                <Button
                  onClick={generatePDFReport}
                  loading={isGenerating}
                  className="w-full"
                  variant="primary"
                  icon={<FileDown className="h-4 w-4" />}
                >
                  Generate PDF Report
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Analytics Dashboard */}
        <div className="space-y-4 lg:col-span-2">
          {/* Matching Performance */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-brand-600" />
                Matching Performance
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <h4 className="text-[13px] font-medium text-gray-900">Score Distribution</h4>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1 flex justify-between text-[13px] text-gray-700">
                        <span>Excellent (≥80%)</span>
                        <span>{matchResult?.candidates?.filter(c => c.overall_score >= 0.8).length || 0}</span>
                      </div>
                      <Progress value={totalMatches > 0 ? (matchResult?.candidates?.filter(c => c.overall_score >= 0.8).length || 0) / totalMatches * 100 : 0} />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-[13px] text-gray-700">
                        <span>Good (60-79%)</span>
                        <span>{matchResult?.candidates?.filter(c => c.overall_score >= 0.6 && c.overall_score < 0.8).length || 0}</span>
                      </div>
                      <Progress value={totalMatches > 0 ? (matchResult?.candidates?.filter(c => c.overall_score >= 0.6 && c.overall_score < 0.8).length || 0) / totalMatches * 100 : 0} />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-[13px] text-gray-700">
                        <span>Fair (&lt;60%)</span>
                        <span>{matchResult?.candidates?.filter(c => c.overall_score < 0.6).length || 0}</span>
                      </div>
                      <Progress value={totalMatches > 0 ? (matchResult?.candidates?.filter(c => c.overall_score < 0.6).length || 0) / totalMatches * 100 : 0} />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-[13px] font-medium text-gray-900">Top Skills in Demand</h4>
                  <div className="space-y-2">
                    {extractTopSkills().slice(0, 5).map((skill, index) => (
                      <div key={skill.skill} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">#{index + 1}</Badge>
                          <span className="text-[13px] text-gray-700">{skill.skill}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-brand-600 transition-all duration-300"
                              style={{ width: `${skill.demand}%` }}
                            />
                          </div>
                          <span className="w-8 text-xs text-gray-500">{skill.demand}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Insights & Recommendations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-brand-600" />
                AI Insights &amp; Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                {generateInsights().length > 0 ? (
                  generateInsights().map((insight, index) => (
                    <div key={index} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4">
                      {insight.type === 'warning' ? (
                        <AlertCircle className="mt-0.5 h-5 w-5 text-amber-500" />
                      ) : (
                        <CheckCircle className="mt-0.5 h-5 w-5 text-brand-500" />
                      )}
                      <div className="flex-1">
                        <div className="mb-1 flex items-center justify-between">
                          <h4 className="text-[13px] font-medium text-gray-900">{insight.title}</h4>
                          <Badge
                            variant={
                              insight.impact === 'High' ? 'danger' :
                              insight.impact === 'Medium' ? 'warning' :
                              'success'
                            }
                          >
                            {insight.impact} Impact
                          </Badge>
                        </div>
                        <p className="text-[13px] text-gray-600">{insight.description}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-gray-500">
                    <BarChart3 className="mx-auto mb-3 h-12 w-12 text-gray-300" />
                    <p className="text-[13px]">No insights available yet</p>
                    <p className="text-xs">Upload CVs and JDs to generate AI-powered insights</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
