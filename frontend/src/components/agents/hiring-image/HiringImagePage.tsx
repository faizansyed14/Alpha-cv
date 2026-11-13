'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Download, ExternalLink, ImageIcon, Loader2, MapPin, Briefcase } from '@/components/icons';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
import { rise } from '@/lib/motion';

const EXAMPLES: Array<[string, string]> = [
  ['Senior Network & Security Engineer', 'Sharjah'],
  ['Finance Manager', 'Dubai'],
  ['Cloud Solutions Architect', 'Abu Dhabi'],
];

function fileNameFor(title: string) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'job';
  return `hiring-${slug}.jpg`;
}

/**
 * Hiring image: type a job title and a city and get a ready-to-post "We are hiring" picture. The picture is drawn on the server
 * from a fixed template (no AI model) and is not saved anywhere: it exists only on this page until it is downloaded.
 */
export default function HiringImagePage() {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [made, setMade] = useState<{ title: string; location: string; kb: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const generate = useCallback(async (t: string, l: string) => {
    const mine = ++run.current;
    if (!t.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const blob = await api.getHiringImage(t.trim(), l.trim());
      if (mine !== run.current) return;                       // a newer request is already on its way
      setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
      setMade({ title: t.trim(), location: l.trim(), kb: Math.round(blob.size / 1024) });
    } catch (e: any) {
      if (mine !== run.current) return;
      setError(e?.detail || e?.response?.data?.detail || e?.message || 'The picture could not be created. Please try again.');
    } finally {
      if (mine === run.current) setLoading(false);
    }
  }, []);

  // The picture follows what is typed, a moment after typing stops.
  useEffect(() => {
    if (!title.trim()) {
      run.current++;
      setLoading(false);
      return;
    }
    const t = setTimeout(() => void generate(title, location), 650);
    return () => clearTimeout(t);
  }, [title, location, generate]);

  useEffect(() => () => { setUrl((old) => { if (old) URL.revokeObjectURL(old); return null; }); }, []);

  const save = () => {
    if (!url || !made) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameFor(made.title);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const stale = !!made && (made.title !== title.trim() || made.location !== location.trim());

  return (
    <div>
      <PageHeader
        title="Hiring image"
        description="Type a job title and a city: you get a ready-to-post We are hiring picture for LinkedIn, Instagram or WhatsApp. It is drawn from a fixed template, with no AI model, and nothing is saved."
      />

      <motion.div variants={rise} initial="hidden" animate="show" className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* the two things to type */}
        <section className="h-fit space-y-5 rounded-2xl border border-surface-border bg-paper p-5 shadow-card">
          <Field label="Job title" required htmlFor="hi-title" hint="As it should appear on the picture">
            <Input
              id="hi-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Senior Network & Security Engineer"
              maxLength={110}
              autoFocus
              leading={<Briefcase />}
            />
          </Field>
          <Field label="Location" htmlFor="hi-location" hint="A city such as Sharjah. Leave it empty for no location.">
            <Input
              id="hi-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Sharjah"
              maxLength={60}
              leading={<MapPin />}
              onKeyDown={(e) => { if (e.key === 'Enter') void generate(title, location); }}
            />
          </Field>

          <div>
            <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.1em] text-slate-400">Try an example</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map(([t, l]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTitle(t); setLocation(l); }}
                  className="rounded-full border border-slate-200 bg-paper px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-navy-300 hover:bg-navy-50 hover:text-navy-800"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-surface-border pt-4">
            <Button variant="primary" icon={<Download />} onClick={save} disabled={!url || loading} className="flex-1">
              Download JPG
            </Button>
            <Button variant="secondary" icon={<ExternalLink />} onClick={() => url && window.open(url, '_blank', 'noopener')} disabled={!url} aria-label="Open full size">
              Full size
            </Button>
          </div>
        </section>

        {/* the picture */}
        <section className="min-w-0">
          <div className="relative mx-auto aspect-square w-full max-w-[640px] overflow-hidden rounded-2xl border border-surface-border bg-slate-50 shadow-card">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={made ? `We are hiring: ${made.title}` : 'Hiring image'}
                className={`block h-full w-full object-contain transition-opacity duration-200 ${loading || stale ? 'opacity-60' : 'opacity-100'}`}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-paper text-navy-700 shadow-raised ring-1 ring-slate-200"><ImageIcon className="h-6 w-6" /></span>
                <p className="text-md font-semibold text-slate-900">Your picture appears here</p>
                <p className="max-w-xs text-sm text-slate-500">Start typing a job title on the left. It is drawn as you type.</p>
              </div>
            )}
            {loading && (
              <div className="absolute inset-x-0 top-0" role="status" aria-label="Drawing the picture">
                <div className="ai-line" />
              </div>
            )}
            {loading && url && (
              <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-paper/90 px-2.5 py-1 text-2xs font-semibold text-slate-600 shadow-soft">
                <Loader2 className="h-3 w-3 animate-spin" /> Drawing…
              </span>
            )}
          </div>
          {error ? (
            <p className="mx-auto mt-3 flex max-w-[640px] items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          ) : made ? (
            <p className="mx-auto mt-3 max-w-[640px] text-center text-xs text-slate-500">1080 × 1080 · JPEG · {made.kb} KB · not saved on the server</p>
          ) : null}
        </section>
      </motion.div>
    </div>
  );
}
