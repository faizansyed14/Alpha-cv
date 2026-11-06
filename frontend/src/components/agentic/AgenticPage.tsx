'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, FileText, PanelLeft, Plus, Upload, X } from '@/components/icons';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ease } from '@/lib/motion';
import type { AgentConversationSummary, AgentMessage, AgentUsage, AgenticCapabilities } from '@/lib/types';
import { Composer } from '@/components/agents/shared/Composer';
import { ConversationList } from '@/components/agents/shared/ConversationList';
import { Thinking } from '@/components/agents/shared/Thinking';
import { UsageMenu } from '@/components/agents/shared/TokenMeter';
import { ModeToggle } from '@/components/layout/ModeToggle';
import { GradientBackdrop } from '@/components/ui/gradient-backdrop';
import { CardActionsProvider, useDocPreview } from './cards/actions';
import { CardRenderer } from './cards/CardRenderer';
import { TraceStrip } from './TraceStrip';
import { Welcome } from './Welcome';

const STEPS = ['Understanding your request', 'Choosing the right skill', 'Checking the application', 'Putting the answer together'];

function errorText(e: any, fallback: string): string {
  return e?.detail || e?.response?.data?.detail || e?.message || fallback;
}

/** Agentic mode: one full-page assistant that can use the application for you (never to delete or change anything). */
export default function AgenticPage() {
  const [caps, setCaps] = useState<AgenticCapabilities | null>(null);
  const [history, setHistory] = useState<AgentConversationSummary[]>([]);
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<{ ref: string; filename: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const refreshHistory = useCallback(async () => {
    try { setHistory(await api.listAgenticConversations()); } catch { /* the list is a convenience */ }
  }, []);

  useEffect(() => {
    let alive = true;
    api.getAgenticCapabilities().then((c) => alive && setCaps(c)).catch((e) => alive && setError(errorText(e, 'Agentic mode could not be loaded.')));
    api.getAgentUsage().then((u) => alive && setUsage(u)).catch(() => undefined);
    void refreshHistory();
    return () => { alive = false; };
  }, [refreshHistory]);

  const outOfTokens = !!usage && usage.remaining <= 0;
  const canSend = !sending && !outOfTokens && !uploading && (draft.trim().length > 0 || !!attachment);
  const showWelcome = messages.length === 0;

  // Chat: stick to the latest message. Welcome: stay at the top so the robot + greeting stay in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (showWelcome) {
      el.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, showWelcome]);

  const newChat = () => { setConversationId(null); setMessages([]); setFreshId(null); setError(null); setDraft(''); setAttachment(null); setDrawer(false); };

  const openConversation = async (id: string) => {
    setError(null); setDrawer(false);
    try {
      const res = await api.getAgenticConversation(id);
      setConversationId(res.conversation.id); setMessages(res.messages); setFreshId(null);
    } catch (e) { setError(errorText(e, 'That conversation could not be opened.')); }
  };

  const deleteConversation = async (id: string) => {
    try {
      await api.hideAgenticConversation(id);
      setHistory((h) => h.filter((c) => c.id !== id));
      if (id === conversationId) newChat();
    } catch (e) { setError(errorText(e, 'That chat could not be deleted.')); }
  };

  /** Read an attached job description. It is only held for the person; nothing is posted until they confirm the draft. */
  const uploadFile = async (file: File): Promise<{ ref: string; filename: string } | null> => {
    setUploading(true); setError(null);
    try {
      const res = await api.agenticUpload(file);
      return { ref: res.ref, filename: res.filename };
    } catch (e) {
      setError(errorText(e, 'That file could not be read.'));
      return null;
    } finally {
      setUploading(false);
    }
  };

  const attachOnly = async (file: File) => { const got = await uploadFile(file); if (got) setAttachment(got); };
  const attachAndSend = async (file: File) => { const got = await uploadFile(file); if (got) await send('', got); };

  const send = async (text?: string, attached?: { ref: string; filename: string } | null, selection?: Record<string, any>) => {
    const file = attached === undefined ? attachment : attached;
    const message = (text ?? draft).trim();
    if ((!message && !file) || sending || outOfTokens) return;
    setError(null); setSending(true); setDraft('');
    const shown = message || 'Post this job from the attached file.';
    const optimistic: AgentMessage = { id: null, seq: messages.length + 1, role: 'user', content: shown, status: 'ok', blocked_reason: null,
      meta: file ? { attachment: { filename: file.filename } } : null, model: null, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const res = await api.agenticChat({ message, conversation_id: conversationId, attachment_ref: file?.ref ?? null, selection: selection ?? null });
      setAttachment(null);
      if (res.usage) setUsage(res.usage);
      if (res.conversation && !conversationId) setConversationId(res.conversation.id);
      setFreshId(res.assistant_message.id);
      setMessages((prev) => [...prev, res.assistant_message]);
      void refreshHistory();
    } catch (e) {
      setMessages((prev) => prev.slice(0, -1));
      setDraft(message);
      if (file && attached) setAttachment(attached);
      setError(errorText(e, 'Something went wrong. Please try again.'));
      void api.getAgentUsage().then(setUsage).catch(() => undefined);
    } finally {
      setSending(false);
    }
  };

  // What the buttons on the cards can do: open a document, act on ONE exact candidate or job (by id), answer a proposed change.
  const docPreview = useDocPreview();
  const cardActions = {
    preview: (id: string, type: 'cv' | 'jd', name?: string) => void docPreview.open(id, type, name),
    review: (cvId: string, name: string) => void send(`Review ${name}`, undefined, { kind: 'review', cv_id: cvId }),
    focus: (t: string, target: { cv_id?: string; job_id?: string; name: string }) => void send(t, undefined, { kind: 'focus', ...target }),
    decide: (kind: 'confirm' | 'cancel_action', actionId: string, label: string) => void send(label, undefined, { kind, action_id: actionId }),
  };

  // The newest draft stays active until the job is posted, the person cancels, or the chat moves to another skill (the same rule the
  // server uses), so a question in between never makes the draft's buttons disappear. Older drafts stay a record.
  const activeDraftAt = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant' || m.status !== 'ok') continue;
      if (m.meta?.specialist !== 'jobs' || m.meta?.cancelled) return -1;
      const cards = m.meta?.cards ?? [];
      if (cards.some((c) => c.type === 'job_posted')) return -1;
      if (cards.some((c) => c.type === 'job_draft')) return i;
    }
    return -1;
  }, [messages]);

  const sidebar = (
    <div className="flex h-full w-[250px] flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
        <img src="/alphadatalogo.svg" alt="" className="h-8 w-8 rounded-lg object-contain" />
        <div className="leading-tight">
          <p className="text-[15px] font-bold tracking-[-0.02em] text-slate-900">Alpha<span className="text-navy-600">CV</span></p>
          <p className="text-[11px] font-medium text-slate-500">Agentic mode</p>
        </div>
      </div>
      <div className="p-2.5">
        <button type="button" onClick={newChat} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium text-slate-800 transition-colors hover:bg-white/70">
          <Plus className="h-4 w-4" /> New chat
        </button>
      </div>
      <ConversationList items={history} activeId={conversationId} onOpen={(id) => void openConversation(id)} onDelete={deleteConversation} />
    </div>
  );

  return (
    <CardActionsProvider value={cardActions}>
    <div className="relative isolate flex h-dvh overflow-hidden">
      <GradientBackdrop calm={!showWelcome} />
      {docPreview.node}

      <motion.aside className="hidden shrink-0 overflow-hidden border-r border-white/60 bg-white/45 backdrop-blur-xl lg:block"
        initial={false} animate={{ width: sideOpen ? 250 : 0 }} transition={{ duration: 0.24, ease }}>
        {sidebar}
      </motion.aside>
      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div className="absolute inset-0 bg-slate-900/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.aside className="absolute inset-y-0 left-0 bg-white shadow-2xl" initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} transition={{ duration: 0.26, ease }}>
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close" className="absolute right-1 top-3 rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
              {sidebar}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 px-2 sm:px-3">
          <button type="button" aria-label="Chats" onClick={() => setDrawer(true)} className="rounded-lg p-2 text-slate-600 hover:bg-white/60 lg:hidden"><PanelLeft className="h-5 w-5" /></button>
          <button type="button" aria-label={sideOpen ? 'Hide chats' : 'Show chats'} onClick={() => setSideOpen((o) => !o)} className="hidden rounded-lg p-2 text-slate-600 hover:bg-white/60 lg:block"><PanelLeft className="h-5 w-5" /></button>
          <p className="ml-1 flex-1 truncate text-[15px] font-semibold text-slate-900">Agentic mode</p>
          <ModeToggle className="mr-1 bg-white/70 backdrop-blur" />
          <UsageMenu usage={usage} onOpen={() => void api.getAgentUsage().then(setUsage).catch(() => undefined)}
            onRequestReset={async (reason) => { setUsage(await api.requestAgentReset(reason)); }} />
        </header>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          {showWelcome ? (
            <Welcome caps={caps} onSend={(t) => void send(t)} disabled={sending || outOfTokens} />
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-7 px-4 py-6 sm:px-6">
              {messages.map((m, i) => (
                <motion.div key={m.id ?? `t${i}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease }}>
                  {m.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-3xl bg-navy-900 px-4 py-2.5 text-[14.5px] leading-relaxed text-white shadow-sm sm:max-w-[560px]">
                        {m.meta?.attachment?.filename ? (
                          <div className="mb-1.5 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white/15 px-2 py-1 text-[12px]"><FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{m.meta.attachment.filename}</span></div>
                        ) : null}
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {m.content && (
                        <div className={cn('inline-block max-w-full whitespace-pre-wrap rounded-2xl px-4 py-3 text-[14.5px] leading-relaxed',
                          m.status === 'error' ? 'border border-rose-200 bg-rose-50 text-rose-800' : 'border border-white/80 bg-white/85 text-slate-900 shadow-sm backdrop-blur')}>
                          {m.content}
                        </div>
                      )}
                      {(m.meta?.cards ?? []).map((card, k) => (
                        <CardRenderer key={k} card={card} onSend={(t) => void send(t)} onSelect={(t, sel) => void send(t, undefined, sel)} fresh={m.id !== null && m.id === freshId}
                          draftActive={card.type === 'upload_prompt' || card.type === 'categories' || card.type === 'match_setup' || card.type === 'action' ? i === messages.length - 1 && !sending : i === activeDraftAt && !sending}
                          onUpload={(f) => void attachAndSend(f)} uploading={uploading} />
                      ))}
                      {i === messages.length - 1 && (m.meta?.suggestions?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {m.meta!.suggestions!.map((s) => (
                            <button key={s} type="button" disabled={sending} onClick={() => void send(s)}
                              className="rounded-full border border-white/80 bg-white/85 px-3.5 py-1.5 text-[12.5px] text-slate-700 shadow-sm backdrop-blur transition-colors hover:bg-white disabled:opacity-50">{s}</button>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-3"><TraceStrip meta={m.meta} />{m.tokens ? <span className="mt-2 text-[11px] tabular-nums text-slate-400">{m.tokens.toLocaleString()} tokens</span> : null}</div>
                    </div>
                  )}
                </motion.div>
              ))}
              <AnimatePresence>{sending && <Thinking key="thinking" steps={STEPS} />}</AnimatePresence>
            </div>
          )}
        </div>

        <div className="shrink-0 px-3 pb-3 sm:px-6 sm:pb-4">
          <div className="mx-auto w-full max-w-3xl">
            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-[12.5px] font-medium text-rose-700">
                    <AlertCircle className="h-4 w-4 shrink-0" /><span className="flex-1">{error}</span>
                    <button type="button" aria-label="Dismiss" onClick={() => setError(null)} className="rounded p-0.5 hover:bg-rose-100"><X className="h-3.5 w-3.5" /></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <input ref={fileInput} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachOnly(f); e.target.value = ''; }} />
            <Composer value={draft} onChange={setDraft} onSend={() => void send()} canSend={canSend} sending={sending} maxLength={2000}
              autoFocus={!showWelcome}
              chips={attachment ? [{ key: 'att', kind: 'jd', label: attachment.filename, onRemove: () => setAttachment(null) }]
                : uploading ? [{ key: 'busy', kind: 'jd', label: 'Reading file...', busy: true }] : []}
              attach={(
                <button type="button" aria-label="Attach a file" title="Attach a job description or a CV" onClick={() => fileInput.current?.click()}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"><Upload className="h-[18px] w-[18px]" /></button>
              )}
              placeholder={showWelcome ? 'Ask me to post a job, find candidates, match, or write something...' : 'Ask for the next step...'}
              locked={outOfTokens ? 'All of today’s tokens are used. See Usage at the top right.' : undefined} />
            <p className="mt-2 text-center text-[11px] text-slate-500">AI can make mistakes. Check results before you act on them. I never delete anything, and I only change something after you confirm it.</p>
          </div>
        </div>
      </section>
    </div>
    </CardActionsProvider>
  );
}
