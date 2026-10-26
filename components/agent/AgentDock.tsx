'use client';

import { Bot, Check, ImagePlus, KeyRound, Loader2, Mic, MicOff, Minus, SendHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState, useTransition, type ClipboardEvent, type KeyboardEvent } from 'react';
import { askAgent } from '@/app/actions';
import type { AgentTurnView } from '@/lib/agent/transcript';
import { imageFiles, toAgentImage, type PendingImage } from './imageInput';
import { useDictation } from './useDictation';

const OPEN_KEY = 'agent-dock-open';
const MAX_IMAGES = 4;

const EXAMPLES = ['My wallet balance is 5,000', 'Add my payroll: 15,000 every 10th and 25th', 'Add a loan: 2,977 monthly, due on the 20th, 12 months', 'Spent 250 on lunch'];

/** Remembered choice; without one, open on desktop and minimized on phones. */
function readOpenPreference(): boolean {
  const fallback = window.matchMedia('(min-width: 640px)').matches;
  try {
    const stored = window.localStorage.getItem(OPEN_KEY);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

function writeOpenPreference(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, String(open));
  } catch {
    /* storage unavailable: the dock just forgets its state */
  }
}

function Bubble({ turn }: { turn: AgentTurnView }) {
  const mine = turn.role === 'user';
  return (
    <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          mine ? 'rounded-br-sm bg-sky-500/15 text-sky-50' : 'rounded-bl-sm border border-slate-800 bg-slate-950/70 text-slate-200'
        }`}
      >
        {turn.imageCount > 0 && <p className="mb-1 text-[11px] text-sky-300/80">📎 {turn.imageCount} screenshot(s)</p>}
        {turn.text || (mine ? '' : <span className="text-slate-500">No reply. Try rephrasing.</span>)}
      </div>
      {turn.changes.length > 0 && (
        <ul className="mt-1.5 max-w-[88%] space-y-1">
          {turn.changes.map((change, index) => (
            <li
              key={index}
              className={`flex items-start gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                change.failed ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {change.failed ? <X className="mt-px h-3 w-3 shrink-0" /> : <Check className="mt-px h-3 w-3 shrink-0" />}
              {change.text}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function SetupNotice() {
  return (
    <div className="m-4 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100">
      <p className="flex items-center gap-1.5 font-semibold text-amber-400">
        <KeyRound className="h-3.5 w-3.5" /> Connect your Claude API key
      </p>
      <ol className="list-decimal space-y-1 pl-4">
        <li>Console → API keys → Create key.</li>
        <li>
          In the project folder create <code className="text-amber-300">.env.local</code> with:
          <br />
          <code className="text-amber-300">ANTHROPIC_API_KEY=sk-ant-…</code>
        </li>
        <li>Restart the app (Ctrl+C, then `debt`).</li>
      </ol>
    </div>
  );
}

export function AgentDock({ turns, configured }: { turns: AgentTurnView[]; configured: boolean }) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [sending, setSending] = useState<{ text: string; imageCount: number } | null>(null);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const listRef = useRef<HTMLUListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dictation = useDictation((phrase) => setDraft((current) => (current ? `${current} ${phrase}` : phrase)));

  useEffect(() => setOpen(readOpenPreference()), []);
  // On wide screens the open dock becomes a sidebar; globals.css makes room for it.
  useEffect(() => {
    document.body.dataset.agentDock = open ? 'open' : 'closed';
  }, [open]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length, sending, open]);

  const toggle = (next: boolean) => {
    setOpen(next);
    writeOpenPreference(next);
  };

  const addImages = async (files: File[]) => {
    const room = MAX_IMAGES - images.length;
    if (room <= 0 || files.length === 0) return;
    try {
      const converted = await Promise.all(files.slice(0, room).map(toAgentImage));
      setImages((current) => [...current, ...converted]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read that image.');
    }
  };

  const send = (text = draft) => {
    if (isPending || (!text.trim() && images.length === 0)) return;
    dictation.stop();
    const payload = images.map(({ mediaType, base64 }) => ({ mediaType, base64 }));
    setSending({ text: text.trim(), imageCount: images.length });
    setDraft('');
    setImages([]);
    setError('');
    startTransition(async () => {
      const result = await askAgent(text, payload);
      if (result.error) {
        setError(result.error);
        setDraft(text);
      }
      setSending(null);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFiles(event.clipboardData.items);
    if (files.length === 0) return;
    event.preventDefault();
    void addImages(files);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => toggle(true)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-sky-500/40 bg-slate-900 px-4 py-3 text-sm font-medium text-sky-300 shadow-2xl shadow-black/50 hover:bg-slate-800"
      >
        <Bot className="h-4 w-4" /> Talk to your agent
      </button>
    );
  }

  return (
    <section
      aria-label="Fin agent chat"
      className="fixed inset-x-2 bottom-2 z-50 flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:h-[min(640px,calc(100vh-2rem))] sm:w-[420px] xl:bottom-0 xl:right-0 xl:top-0 xl:h-screen xl:w-[400px] xl:rounded-none xl:border-y-0 xl:border-r-0 xl:shadow-none"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void addImages(imageFiles(event.dataTransfer.files));
      }}
    >
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-sky-400" />
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Fin Agent</h2>
            <p className="text-[11px] text-slate-500">Tell me what happened. I update everything.</p>
          </div>
        </div>
        <button type="button" aria-label="Minimize" className="rounded-md p-1 text-slate-400 hover:bg-slate-800" onClick={() => toggle(false)}>
          <Minus className="h-4 w-4" />
        </button>
      </header>

      {!configured ? (
        <SetupNotice />
      ) : (
        <ul ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {turns.length === 0 && !sending && (
            <li className="space-y-2 text-xs text-slate-500">
              <p>Today&apos;s chat is empty. Try one of these, or paste a bank screenshot:</p>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((example) => (
                  <button key={example} type="button" className="btn-neutral text-left" onClick={() => setDraft(example)}>
                    {example}
                  </button>
                ))}
              </div>
            </li>
          )}
          {turns.map((turn) => (
            <Bubble key={turn.id} turn={turn} />
          ))}
          {sending && (
            <>
              <Bubble turn={{ id: 'pending', role: 'user', text: sending.text, imageCount: sending.imageCount, changes: [] }} />
              <li className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" /> Updating your data…
              </li>
            </>
          )}
        </ul>
      )}

      {error && <p className="border-t border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-300">{error}</p>}

      {configured && (
        <footer className="border-t border-slate-800 p-3">
          {images.length > 0 && (
            <div className="mb-2 flex gap-2">
              {images.map((image, index) => (
                <div key={index} className="relative">
                  <img src={image.previewUrl} alt="Attached screenshot" className="h-14 w-14 rounded-md border border-slate-700 object-cover" />
                  <button
                    type="button"
                    aria-label="Remove screenshot"
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-slate-800 p-0.5 text-slate-300 hover:text-rose-400"
                    onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-1.5 rounded-xl border border-slate-700 bg-slate-950 p-1.5 focus-within:border-sky-500">
            <button type="button" aria-label="Attach screenshot" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200" onClick={() => fileRef.current?.click()}>
              <ImagePlus className="h-4 w-4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                void addImages(imageFiles(event.target.files));
                event.target.value = '';
              }}
            />
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={1}
              placeholder={dictation.listening ? 'Listening…' : 'e.g. "Got paid today, wallet is now 14,599.65"'}
              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
            />
            {dictation.supported && (
              <button
                type="button"
                aria-label={dictation.listening ? 'Stop dictation' : 'Dictate'}
                className={`rounded-lg p-2 ${dictation.listening ? 'animate-pulse bg-rose-500/20 text-rose-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
                onClick={dictation.listening ? dictation.stop : dictation.start}
              >
                {dictation.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <button
              type="button"
              aria-label="Send"
              disabled={isPending || (!draft.trim() && images.length === 0)}
              className="rounded-lg bg-sky-500 p-2 text-slate-950 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-600"
              onClick={() => send()}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-slate-600">Enter to send • paste or drop screenshots • new chat each day</p>
        </footer>
      )}
    </section>
  );
}
