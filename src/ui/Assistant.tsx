import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../data/store.tsx';
import { AssistantUnavailable, type ChatMessage } from '../data/platform.ts';
import { describeError } from '../data/repo.ts';
import { HELP_TOPICS, searchHelp, type HelpTopic } from '../../supabase/functions/_shared/help.ts';
import { href } from './router.ts';

interface Msg { role: 'user' | 'assistant'; text: string; topics?: HelpTopic[]; source?: 'aide' | 'ia'; note?: string }

/** Texte d'aide simplifié : **gras**, listes « - » ou « 1. », retours à la ligne. Aucun HTML injecté. */
function Rich({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const line of text.split('\n')) {
    const m = /^\s*(?:(-|•)|(\d+)\.)\s+(.*)$/.exec(line);
    if (m) {
      const ordered = !!m[2];
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push(m[3]!);
    } else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Tableau de bord', prospection: 'Prospection', simulateur: 'Simulateur', biens: 'Mes biens', locataires: 'Locataires et baux',
  loyers: 'Loyers et paiements', depenses: 'Dépenses', contacts: 'Contacts', documents: 'Documents', fiscal: 'Déclaration fiscale',
  abonnement: 'Mon abonnement', parametres: 'Paramètres', admin: 'Administration',
};

function suggestions(page: string): string[] {
  const qs = HELP_TOPICS.filter((t) => t.pages.includes(page)).flatMap((t) => t.questions ?? []);
  return (qs.length ? qs : HELP_TOPICS.find((t) => t.id === 'demarrer')!.questions!).slice(0, 4);
}

function localAnswer(q: string, page: string): Msg {
  const topics = searchHelp(q, page);
  if (!topics.length) {
    return { role: 'assistant', source: 'aide', text: 'Je n’ai pas trouvé de réponse précise dans l’aide. Reformulez avec les mots de l’écran (ex. « quittance », « import », « bail »), ou choisissez un sujet ci-dessous.',
      topics: HELP_TOPICS.filter((t) => t.pages.includes(page)).slice(0, 3) };
  }
  const [first, ...rest] = topics;
  return { role: 'assistant', source: 'aide', text: `**${first!.title}**\n${first!.body}`, topics: rest };
}

export function AssistantButton({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm assistant-toggle" aria-expanded={open} aria-controls="assistant" onClick={() => setOpen(!open)}>
        <span aria-hidden="true">?</span> Assistant
      </button>
      {open && <AssistantPanel page={page} onClose={() => setOpen(false)} />}
    </>
  );
}

function AssistantPanel({ page, onClose }: { page: string; onClose: () => void }) {
  const { repo } = useStore();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // conversationnel tant que le serveur n'a pas répondu « non configuré »
  const [remote, setRemote] = useState<'inconnu' | 'actif' | 'absent'>(repo.mode === 'demo' ? 'absent' : 'inconnu');
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    const history: Msg[] = [...msgs, { role: 'user', text: q }];
    setMsgs(history);
    if (remote === 'absent') { setMsgs([...history, localAnswer(q, page)]); return; }
    setBusy(true);
    try {
      const chat: ChatMessage[] = history.slice(-10).map((m) => ({ role: m.role, content: m.text }));
      const answer = await repo.platform.ask(chat, PAGE_LABELS[page] ?? page);
      setRemote('actif');
      setMsgs([...history, { role: 'assistant', source: 'ia', text: answer, topics: searchHelp(q, page, 2) }]);
    } catch (e) {
      if (e instanceof AssistantUnavailable) { setRemote('absent'); setMsgs([...history, localAnswer(q, page)]); }
      else setMsgs([...history, { ...localAnswer(q, page), note: `${describeError(e)} Réponse tirée de l’aide intégrée :` }]);
    } finally {
      setBusy(false);
    }
  }

  const showTopic = (t: HelpTopic) => setMsgs((m) => [...m, { role: 'user', text: t.title }, { role: 'assistant', source: 'aide', text: `**${t.title}**\n${t.body}`, topics: [] }]);
  const topicOf = (m: Msg) => (m.source === 'aide' ? HELP_TOPICS.find((t) => m.text.startsWith(`**${t.title}**`)) : undefined);

  return (
    <aside id="assistant" className="assistant" role="dialog" aria-modal="false" aria-label="Assistant Immo-Zen">
      <div className="assistant-head">
        <div>
          <h2>Assistant Immo-Zen</h2>
          <p className="muted small">{remote === 'actif' ? 'Assistant IA (Claude) · ' : 'Aide intégrée · '}rubrique {PAGE_LABELS[page] ?? page}</p>
        </div>
        <button type="button" className="icon-btn" aria-label="Fermer l’assistant" onClick={onClose}>×</button>
      </div>
      <div className="assistant-body" aria-live="polite">
        <div className="assistant-msg bot">
          <p>Bonjour ! Je vous explique le fonctionnement d’Immo-Zen. Posez votre question ou choisissez :</p>
          <div className="assistant-chips">{suggestions(page).map((q) => <button key={q} type="button" className="chip" onClick={() => void ask(q)}>{q}</button>)}</div>
        </div>
        {msgs.map((m, i) => {
          const t = topicOf(m);
          return (
            <div key={i} className={`assistant-msg ${m.role === 'user' ? 'me' : 'bot'}`}>
              {m.note && <p className="muted small">{m.note}</p>}
              {m.role === 'user' ? <p>{m.text}</p> : <Rich text={m.text} />}
              {t?.actions && <div className="assistant-chips">{t.actions.map((a) => <a key={a.path} className="chip" href={href(a.path)} onClick={onClose}>{a.label} →</a>)}</div>}
              {m.topics && m.topics.length > 0 && (
                <div className="assistant-more"><span className="muted small">Voir aussi :</span>{m.topics.map((x) => <button key={x.id} type="button" className="chip" onClick={() => showTopic(x)}>{x.title}</button>)}</div>
              )}
            </div>
          );
        })}
        {busy && <div className="assistant-msg bot"><p className="muted">L’assistant rédige sa réponse…</p></div>}
        <div ref={end} />
      </div>
      <form className="assistant-form" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
        <textarea ref={field} rows={2} aria-label="Votre question" placeholder="Ex. Comment importer mes loyers ?" value={input} maxLength={1000}
          onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(input); } }} />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>Envoyer</button>
      </form>
      <p className="assistant-foot muted small">L’assistant explique l’application ; il ne voit pas vos données et ne remplace pas un conseil fiscal ou juridique.</p>
    </aside>
  );
}
