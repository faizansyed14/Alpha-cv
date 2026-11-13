'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, PanelLeft, Plus, X } from '@/components/icons';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { ComboboxOption } from '@/components/ui/combobox';
import { cn } from '@/lib/utils';
import { ease } from '@/lib/motion';
import type { AgentConversationSummary, AgentInfo, AgentMessage, AgentUsage } from '@/lib/types';
import { AttachMenu } from './AttachMenu';
import { Composer, type Chip } from './Composer';
import { ConversationList } from './ConversationList';
import { readAgentPreset, type AgentPreset } from '@/lib/agentLinks';
import { cvReady, EMPTY_SETUP, jdReady, type SetupState } from './setup';
import { Thinking } from './Thinking';
import { ModeToggle } from '@/components/layout/ModeToggle';
import { UsageMenu } from './TokenMeter';

export interface AgentChatShellProps {
  agentId: 'interview' | 'linkedin';
  title: string;                                   // header and sidebar title
  headline: string;                                // heading on the start screen
  blurb: string;                                   // one line under it
  /** Real image mark above the start-screen headline (and beside the header title). */
  heroMarkSrc?: string;
  workingSteps: string[];                          // status lines while the answer is written
  workingStepsWithCv?: string[];
  renderAnswer: (message: AgentMessage, ctx: { fresh: boolean }) => ReactNode;
}

const SIDE_W = 168;

function errorText(e: any, fallback: string): string {
  return e?.detail || e?.response?.data?.detail || e?.message || fallback;
}

/** A refusal or an error, drawn the same for every agent. A good answer is drawn by the agent's own component. */
function Note({ m }: { m: AgentMessage }) {
  const isError = m.status === 'error';
  return (
    <div className={cn('inline-flex max-w-[640px] items-start gap-2.5 rounded-2xl border px-4 py-3 text-base leading-relaxed',
      isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-paper/90 text-slate-800')}>
      {isError && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{m.content}</span>
    </div>
  );
}

export function AgentChatShell({ agentId, title, headline, blurb, heroMarkSrc, workingSteps, workingStepsWithCv, renderAnswer }: AgentChatShellProps) {
  const jds = useAppStore((s) => s.jds);
  const cvs = useAppStore((s) => s.cvs);
  const loadJDs = useAppStore((s) => s.loadJDs);
  const loadCVs = useAppStore((s) => s.loadCVs);

  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [history, setHistory] = useState<AgentConversationSummary[]>([]);
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [jobLabel, setJobLabel] = useState<string | null>(null);
  const [cvLabel, setCvLabel] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);
  const [setup, setSetupState] = useState<SetupState>(EMPTY_SETUP);
  const [uploading, setUploading] = useState<'jd' | 'cv' | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Opened from a match result or a job description: the job (and candidate) arrive attached and the answer starts by itself.
  const preset = useRef<AgentPreset | null>(null);
  const autoStarted = useRef(false);
  const [presetLabels, setPresetLabels] = useState<{ jd?: string; cv?: string }>({});

  const acceptsCv = !!info?.accepts_cv;
  const patch = useCallback((p: Partial<SetupState>) => setSetupState((s) => ({ ...s, ...p })), []);

  const refreshHistory = useCallback(async () => {
    try { setHistory(await api.listAgentConversations(agentId)); } catch { /* the list is a convenience */ }
  }, [agentId]);

  useEffect(() => {
    let alive = true;
    api.getAgentInfo(agentId).then((a) => alive && setInfo(a)).catch(() => undefined);
    api.getAgentUsage().then((u) => alive && setUsage(u)).catch(() => undefined);
    void refreshHistory();
    if (!jds || jds.length === 0) loadJDs?.();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  useEffect(() => {
    const p = readAgentPreset(window.location.search);
    if (!p) return;
    preset.current = p;
    setSetupState((s) => ({
      ...s,
      jdSource: 'library', libraryId: p.jdId, pastedText: '', uploaded: null,
      ...(p.cvId ? { cvMode: 'library' as const, cvLibraryId: p.cvId, cvUploaded: null } : {}),
    }));
    setPresetLabels({ jd: p.jdTitle, cv: p.cvTitle });
    window.history.replaceState(null, '', window.location.pathname);   // a reload must not start the answer a second time
  }, []);

  useEffect(() => {
    if (acceptsCv && (!cvs || cvs.length === 0)) loadCVs?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptsCv]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const jdOptions = useMemo<ComboboxOption[]>(
    () => (jds || []).map((j: any) => ({
      value: String(j.id),
      label: String((j.job_title && j.job_title !== 'Not specified' ? j.job_title : j.filename) || j.id),
      hint: j.job_title && j.filename ? String(j.filename) : undefined,
    })),
    [jds],
  );
  const cvOptions = useMemo<ComboboxOption[]>(
    () => (cvs || []).map((c: any) => ({
      value: String(c.id),
      label: String(c.full_name && c.full_name !== 'Not specified' ? c.full_name : c.filename || c.id),
      hint: [c.job_title && c.job_title !== 'Not specified' ? c.job_title : '', c.filename].filter(Boolean).join(' · ') || undefined,
    })),
    [cvs],
  );

  const newChat = () => {
    setConversationId(null); setJobLabel(null); setCvLabel(null); setMessages([]); setFreshId(null); setError(null); setDraft(''); setDrawer(false);
  };

  const openConversation = async (id: string) => {
    setError(null); setDrawer(false);
    try {
      const res = await api.getAgentConversation(agentId, id);
      setConversationId(res.conversation.id);
      setJobLabel(res.conversation.jd_title || res.conversation.title);
      setCvLabel(res.conversation.cv_title || null);
      setMessages(res.messages);
      setFreshId(null);
    } catch (e) {
      setError(errorText(e, 'That conversation could not be opened.'));
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      await api.hideAgentConversation(agentId, id);
      setHistory((h) => h.filter((c) => c.id !== id));
      if (id === conversationId) newChat();
    } catch (e) {
      setError(errorText(e, 'That chat could not be deleted.'));
    }
  };

  const onUpload = async (kind: 'jd' | 'cv', file: File) => {
    setUploading(kind); setError(null);
    try {
      const res = await api.agentExtractText(file, kind);
      patch(kind === 'jd' ? { jdSource: 'uploaded', uploaded: res } : { cvMode: 'uploaded', cvUploaded: res });
    } catch (e) {
      setError(errorText(e, 'That file could not be read.'));
    } finally {
      setUploading(null);
    }
  };

  const outOfTokens = !!usage && usage.remaining <= 0;
  const attached = jdReady(setup) && uploading === null;
  // before a chat starts you can already say hello (answered instantly, for free); a real request needs a job attached
  const canSend = !sending && !outOfTokens && (conversationId ? draft.trim().length > 0 : attached);
  const hasCv = conversationId ? !!cvLabel : acceptsCv && cvReady(setup);

  const send = async (text?: string) => {
    const message = (text ?? draft).trim() || (!conversationId ? info?.default_request ?? '' : '');
    if (!message || sending || outOfTokens) return;
    setError(null); setSending(true); setDraft('');
    const optimistic: AgentMessage = { id: null, seq: messages.length + 1, role: 'user', content: message, status: 'ok', blocked_reason: null, meta: null, model: null, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const body = conversationId
        ? { message, conversation_id: conversationId }
        : {
            message,
            jd_source: setup.jdSource,
            jd_id: setup.jdSource === 'library' ? setup.libraryId : null,
            jd_text: setup.jdSource === 'pasted' ? setup.pastedText : setup.jdSource === 'uploaded' ? setup.uploaded?.text : null,
            jd_title: setup.jdSource === 'uploaded' ? setup.uploaded?.filename : null,
            cv_source: acceptsCv ? setup.cvMode : ('none' as const),
            cv_id: acceptsCv && setup.cvMode === 'library' ? setup.cvLibraryId : null,
            cv_text: acceptsCv && setup.cvMode === 'uploaded' ? setup.cvUploaded?.text : null,
            cv_title: acceptsCv && setup.cvMode === 'uploaded' ? setup.cvUploaded?.filename : null,
          };
      const res = await api.agentChat(agentId, body);
      if (res.usage) setUsage(res.usage);
      if (res.conversation && !conversationId) {
        setConversationId(res.conversation.id);
        setJobLabel(res.conversation.jd_title || res.conversation.title);
        setCvLabel(res.conversation.cv_title || null);
      }
      setFreshId(res.assistant_message.id);
      setMessages((prev) => [...prev, res.assistant_message]);
      void refreshHistory();
    } catch (e) {
      setMessages((prev) => prev.slice(0, -1));
      setDraft(message);
      setError(errorText(e, 'Something went wrong. Please try again.'));
      void api.getAgentUsage().then(setUsage).catch(() => undefined);
    } finally {
      setSending(false);
    }
  };

  // started from a link: once the agent's details are known and the attachments are in place, send the default request one time
  useEffect(() => {
    const p = preset.current;
    if (!p || autoStarted.current || !info || conversationId || sending || outOfTokens) return;
    if (!jdReady(setup) || (p.cvId && info.accepts_cv && !cvReady(setup))) return;
    autoStarted.current = true;
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, setup, conversationId, sending, outOfTokens]);

  // what is attached, shown as chips in the message box (removable until the chat starts)
  const chips: Chip[] = useMemo(() => {
    const out: Chip[] = [];
    if (conversationId) {
      if (jobLabel) out.push({ key: 'jd', kind: 'jd', label: jobLabel });
      if (cvLabel) out.push({ key: 'cv', kind: 'cv', label: cvLabel });
      return out;
    }
    if (uploading === 'jd') out.push({ key: 'jd-busy', kind: 'jd', label: 'Reading file...', busy: true });
    else if (jdReady(setup)) {
      const label = setup.jdSource === 'library' ? jdOptions.find((o) => o.value === setup.libraryId)?.label ?? presetLabels.jd ?? 'Job description'
        : setup.jdSource === 'pasted' ? `Pasted text (${setup.pastedText.length.toLocaleString()} characters)` : setup.uploaded?.filename ?? 'Uploaded file';
      out.push({ key: 'jd', kind: 'jd', label, onRemove: () => patch({ libraryId: '', pastedText: '', uploaded: null }) });
    }
    if (uploading === 'cv') out.push({ key: 'cv-busy', kind: 'cv', label: 'Reading file...', busy: true });
    else if (acceptsCv && cvReady(setup)) {
      const label = setup.cvMode === 'library' ? cvOptions.find((o) => o.value === setup.cvLibraryId)?.label ?? presetLabels.cv ?? 'Candidate CV' : setup.cvUploaded?.filename ?? 'Uploaded CV';
      out.push({ key: 'cv', kind: 'cv', label, onRemove: () => patch({ cvMode: 'none', cvLibraryId: '', cvUploaded: null }) });
    }
    return out;
  }, [conversationId, jobLabel, cvLabel, setup, uploading, jdOptions, cvOptions, acceptsCv, patch, presetLabels]);

  const showStart = !conversationId && messages.length === 0;
  const steps = hasCv && workingStepsWithCv ? workingStepsWithCv : workingSteps;
  const placeholder = conversationId
    ? 'Ask for changes, or for more'
    : attached ? `Press Enter for "${info?.default_request ?? 'the default request'}", or type your own` : 'Attach a job description with + to begin, ';

  const composer = (
    <Composer
      value={draft} onChange={setDraft} onSend={() => void send()} canSend={canSend} sending={sending} placeholder={placeholder}
      chips={chips} maxLength={info?.max_message_chars ?? 1500} autoFocus={showStart}
      locked={outOfTokens ? 'All of today’s tokens are used. See Usage at the top right.' : undefined}
      attach={!conversationId ? (
        <AttachMenu setup={setup} patch={patch} jdOptions={jdOptions} cvOptions={cvOptions} acceptsCv={acceptsCv}
          onUpload={(k, f) => void onUpload(k, f)} maxJdChars={info?.max_jd_chars ?? 12000} />
      ) : undefined}
    />
  );

  const examples = info?.examples ?? [];
  const sidebar = (
    <div className="flex h-full flex-col" style={{ width: SIDE_W }}>
      <div className="p-2.5">
        <button type="button" onClick={newChat}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-200/60">
          <Plus className="h-4 w-4" /> New chat
        </button>
      </div>
      <ConversationList items={history} activeId={conversationId} onOpen={(id) => void openConversation(id)} onDelete={deleteConversation} />
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-3rem)] overflow-hidden bg-paper lg:h-dvh">
      <motion.aside
        className="hidden shrink-0 overflow-hidden border-r border-slate-200 bg-slate-50 lg:block"
        initial={false} animate={{ width: sideOpen ? SIDE_W : 0 }} transition={{ duration: 0.24, ease }}
      >
        {sidebar}
      </motion.aside>

      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div className="absolute inset-0 bg-scrim/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.aside className="absolute inset-y-0 left-0 bg-slate-50 shadow-2xl" initial={{ x: -SIDE_W }} animate={{ x: 0 }} exit={{ x: -SIDE_W }} transition={{ duration: 0.26, ease }}>
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close" className="absolute right-1 top-2.5 rounded-lg p-2 text-slate-400 hover:bg-slate-200/60"><X className="h-4 w-4" /></button>
              {sidebar}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <section className="relative flex min-w-0 flex-1 flex-col bg-paper">
        <header className="flex h-14 shrink-0 items-center gap-1 px-2 sm:px-3">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Chats" className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 lg:hidden"><PanelLeft className="h-5 w-5" /></button>
          <button type="button" onClick={() => setSideOpen((o) => !o)} aria-label={sideOpen ? 'Hide chats' : 'Show chats'} className="hidden rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 lg:block"><PanelLeft className="h-5 w-5" /></button>
          <div className="ml-1 flex min-w-0 flex-1 items-center gap-2">
            {heroMarkSrc ? (
              <img src={heroMarkSrc} alt="" draggable={false} className="h-6 w-6 shrink-0 rounded-md object-cover" />
            ) : null}
            <p className="truncate text-md font-semibold text-slate-900">{title}</p>
          </div>
          <ModeToggle className="mr-1" />
          <UsageMenu usage={usage} onOpen={() => void api.getAgentUsage().then(setUsage).catch(() => undefined)}
            onRequestReset={async (reason) => { setUsage(await api.requestAgentReset(reason)); }} />
        </header>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          {showStart ? (
            <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-4 pb-24 pt-4 sm:px-6">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }} className="mb-7 text-center">
                {heroMarkSrc ? (
                  <img
                    src={heroMarkSrc}
                    alt=""
                    draggable={false}
                    className="mx-auto mb-4 h-16 w-16 rounded-2xl object-cover shadow-md ring-1 ring-black/5 sm:h-[72px] sm:w-[72px]"
                  />
                ) : null}
                <h1 className="text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-[32px]">{headline}</h1>
                <p className="mx-auto mt-2 max-w-md text-base leading-relaxed text-slate-500">{blurb}</p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease, delay: 0.08 }}>
                {composer}
              </motion.div>
              <AnimatePresence>
                {error && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 flex items-center gap-2 text-sm font-medium text-rose-700">
                    <AlertCircle className="h-4 w-4 shrink-0" />{error}
                  </motion.p>
                )}
              </AnimatePresence>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="mt-4 flex flex-wrap justify-center gap-2">
                {examples.map((ex) => (
                  <button key={ex} type="button" disabled={!attached || sending || outOfTokens} onClick={() => void send(ex)}
                    className="rounded-full border border-slate-200 bg-paper px-3.5 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-paper">
                    {ex}
                  </button>
                ))}
              </motion.div>
              {!attached && <p className="mt-4 text-center text-xs text-slate-400">Use the + button to attach a job description first.</p>}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-7 px-4 py-6 sm:px-6">
              {messages.map((m, i) => (
                <motion.div key={m.id ?? `t${i}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26, ease }}>
                  {m.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-solid px-4 py-2.5 text-base leading-relaxed text-white sm:max-w-[560px]">{m.content}</div>
                    </div>
                  ) : (
                    <div>
                      {m.status !== 'ok'
                        ? <Note m={m} />
                        : (renderAnswer(m, { fresh: m.id !== null && m.id === freshId })
                          ?? <div className="whitespace-pre-wrap text-base leading-relaxed text-slate-900">{m.content}</div>)}
                      {m.tokens ? <p className="mt-2 text-2xs tabular-nums text-slate-400">{m.tokens.toLocaleString()} tokens</p> : null}
                    </div>
                  )}
                </motion.div>
              ))}
              <AnimatePresence>{sending && <Thinking key="thinking" steps={steps} />}</AnimatePresence>
            </div>
          )}
        </div>

        {!showStart && (
          <div className="shrink-0 px-3 pb-3 sm:px-6 sm:pb-4">
            <div className="mx-auto w-full max-w-3xl">
              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="mb-2 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-700">
                      <AlertCircle className="h-4 w-4 shrink-0" /><span className="flex-1">{error}</span>
                      <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-rose-100"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {conversationId && examples.length > 0 && (
                <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                  {examples.map((ex) => (
                    <button key={ex} type="button" disabled={sending || outOfTokens} onClick={() => void send(ex)}
                      className="shrink-0 rounded-full border border-slate-200 bg-paper px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                      {ex}
                    </button>
                  ))}
                </div>
              )}
              {composer}
              <p className="mt-2 text-center text-2xs text-slate-400">AI can make mistakes. Check answers before you use them. Chats are saved to your account.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
