import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JobCard from '@/components/careers/JobCard';
import type { JobPostingListItem } from '@/lib/types';

const job: JobPostingListItem = {
  job_id: 'j1',
  job_title: 'Senior Python Developer',
  filename: '',
  upload_date: '2026-03-05T10:00:00Z',
  is_active: true,
  public_token: 'tok',
  posted_by_user: 'rita',
  application_count: 12,
  email_subject_template: 'Senior Python Developer - JOB-0042',
};

describe('JobCard', () => {
  it('shows the title, poster, subject, applicant count and a View more button', () => {
    const html = renderToStaticMarkup(<JobCard job={job} currentUser="bob" onOpen={() => {}} />);
    expect(html).toContain('Senior Python Developer');
    expect(html).toContain('rita');
    expect(html).toContain('Senior Python Developer - JOB-0042');
    expect(html).toContain('>12<');
    expect(html).toContain('applicants');
    expect(html).toContain('View more');
  });

  it('copes with a job that has no subject and no applicants', () => {
    const html = renderToStaticMarkup(<JobCard job={{ ...job, application_count: 0, email_subject_template: undefined, is_active: false }} onOpen={() => {}} />);
    expect(html).toContain('No subject line yet');
    expect(html).toContain('Inactive');
    expect(html).toContain('>0<');
  });
});
