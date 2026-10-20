import { useMemo, useRef, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { DocumentCategory, DocumentRow } from '../../data/types.ts';
import { dateTime } from '../../domain/format.ts';
import { DataTable, type Column } from '../../ui/DataTable.tsx';
import { Button, Checkbox, EmptyState, Modal, PageHeader, Section, Select, TextInput, useConfirm } from '../../ui/components.tsx';
import { useRental } from './common.tsx';

export const DOC_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  bail: 'Bail', quittance: 'Quittance', facture: 'Facture / justificatif', diagnostic: 'Diagnostic', assurance: 'Assurance', fiscal: 'Fiscal',
  copropriete: 'Copropriété', photo: 'Photo', identite: 'Pièce du locataire', autre: 'Autre',
};
export const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/heic': 'HEIC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'text/plain': 'Texte',
};
export const MAX_SIZE = 10 * 1024 * 1024;
const EXT_TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain' };

export function fileType(f: File): string | null {
  if (ALLOWED_TYPES[f.type]) return f.type;
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TYPES[ext] ?? null;
}
export const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`);
export const safeName = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80) || 'fichier';

export function checkFile(f: File): string | null {
  if (!fileType(f)) return `Type de fichier non accepté (${f.name}). Formats acceptés : ${Object.values(ALLOWED_TYPES).join(', ')}.`;
  if (f.size > MAX_SIZE) return `Fichier trop volumineux (${size(f.size)}) : 10 Mo maximum.`;
  if (f.size === 0) return 'Fichier vide.';
  return null;
}

/** Dépose un fichier dans le stockage privé puis enregistre sa fiche. */
export function useUpload() {
  const store = useStore();
  return async (file: File, meta: Partial<DocumentRow> & { title: string }): Promise<DocumentRow | null> => {
    const err = checkFile(file);
    if (err) { store.notify(err, 'error'); return null; }
    if (!store.session) return null;
    const id = crypto.randomUUID();
    const path = `${store.session.userId}/${id}/${safeName(file.name)}`;
    const mime = fileType(file)!;
    const up = await store.call((r) => r.uploadFile(path, file, mime));
    if (up === null) return null;
    const row = await store.create('documents', { ...meta, id, storage_path: path, mime_type: mime, size_bytes: file.size });
    if (!row) await store.repo.removeFile(path).catch(() => undefined);
    return row;
  };
}

export async function openDocument(repo: ReturnType<typeof useStore>['repo'], d: DocumentRow) {
  // lien temporaire de 60 secondes ; ouvert dans un nouvel onglet
  const w = window.open('', '_blank');
  try {
    const url = await repo.fileUrl(d.storage_path, 60);
    if (w) w.location.href = url; else location.href = url;
  } catch (e) {
    w?.close();
    throw e;
  }
}

export function DocumentsPage() {
  return (
    <>
      <PageHeader title="Documents" subtitle="Documents privés de vos biens, baux et dépenses. Accès par lien temporaire, réservé à votre compte." />
      <DocumentList />
    </>
  );
}

/** Liste de documents, éventuellement restreinte à un bien ou un bail. */
export function DocumentList({ filter }: { filter?: { property_id?: string; lease_id?: string } }) {
  const store = useStore();
  const { data, notify } = store;
  const { leaseById, leaseLabel, propertyById } = useRental();
  const { ask, dialog } = useConfirm();
  const [upload, setUpload] = useState(false);
  const [category, setCategory] = useState<DocumentCategory | ''>('');
  const rows = useMemo(() => data.documents.filter((d) => {
    if (filter?.lease_id && d.lease_id !== filter.lease_id && !(filter.property_id && d.property_id === filter.property_id && !d.lease_id)) return false;
    if (!filter?.lease_id && filter?.property_id && d.property_id !== filter.property_id) return false;
    return !category || d.category === category;
  }), [data.documents, filter, category]);

  const columns: Column<DocumentRow>[] = [
    { id: 'title', label: 'Titre', value: (d) => d.title, primary: true },
    { id: 'category', label: 'Catégorie', value: (d) => DOC_CATEGORY_LABELS[d.category], mobile: true },
    { id: 'property', label: 'Bien', value: (d) => (d.property_id ? propertyById.get(d.property_id)?.title ?? null : null), mobile: !filter },
    { id: 'lease', label: 'Bail', value: (d) => { const l = d.lease_id ? leaseById.get(d.lease_id) : undefined; return l ? leaseLabel(l) : null; }, defaultHidden: true },
    { id: 'type', label: 'Format', value: (d) => ALLOWED_TYPES[d.mime_type] ?? d.mime_type },
    { id: 'size', label: 'Taille', value: (d) => d.size_bytes, kind: 'number', align: 'right', render: (d) => size(d.size_bytes) },
    { id: 'created', label: 'Ajouté le', value: (d) => d.created_at, render: (d) => dateTime(d.created_at), mobile: true },
    { id: 'shared', label: 'Espace locataire', value: (d) => (d.shared_with_tenant ? 'Partagé' : null), render: (d) => (d.shared_with_tenant ? <span className="pill pill-ok">Partagé</span> : <span className="muted">—</span>) },
  ];
  const toggleShare = async (d: DocumentRow) => {
    if (!d.lease_id && !d.tenant_id) { notify('Rattachez d’abord le document à un bail pour le partager avec le locataire.', 'error'); return; }
    if (await store.update('documents', d, { shared_with_tenant: !d.shared_with_tenant }, `Le document « ${d.title} »`)) notify(d.shared_with_tenant ? 'Document retiré de l’espace locataire.' : 'Document partagé avec le locataire.');
  };
  const remove = async (d: DocumentRow) => {
    const linked = data.expenses.filter((e) => e.document_id === d.id).length;
    if (!(await ask('Supprimer le document', <>« {d.title} » sera supprimé définitivement{linked ? `, et retiré de ${linked} dépense(s)` : ''}.</>, 'Supprimer'))) return;
    await store.repo.removeFile(d.storage_path).catch(() => undefined); // le serveur supprime aussi le fichier si besoin
    if (await store.remove('documents', d.id)) notify('Document supprimé.');
  };
  const open = (d: DocumentRow) => openDocument(store.repo, d).catch((e: Error) => notify(e.message, 'error'));

  return (
    <Section>
      <DataTable id={filter ? 'documents-lies' : 'documents'} rows={rows} columns={columns} rowKey={(d) => d.id} initialSort={{ id: 'created', dir: 'desc' }}
        onOpen={(d) => void open(d)}
        toolbar={<>
          <label className="inline-select">Catégorie
            <select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory | '')}>
              <option value="">Toutes</option>{(Object.keys(DOC_CATEGORY_LABELS) as DocumentCategory[]).map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABELS[c]}</option>)}
            </select></label>
          <Button size="sm" variant="primary" onClick={() => setUpload(true)}>Ajouter un document</Button>
        </>}
        rowActions={(d) => [
          { label: 'Ouvrir', onSelect: () => void open(d) },
          { label: d.shared_with_tenant ? 'Ne plus partager avec le locataire' : 'Partager avec le locataire', onSelect: () => void toggleShare(d) },
          { label: 'Supprimer', danger: true, onSelect: () => void remove(d) },
        ]}
        empty={<EmptyState title="Aucun document" action={<Button variant="primary" onClick={() => setUpload(true)}>Ajouter un document</Button>}>PDF, images, Word, Excel ou texte, 10 Mo maximum par fichier.</EmptyState>} />
      <UploadDialog open={upload} onClose={() => setUpload(false)} defaults={filter} />
      {dialog}
    </Section>
  );
}

function UploadDialog({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults?: { property_id?: string; lease_id?: string } }) {
  const store = useStore();
  const upload = useUpload();
  const { leaseLabel } = useRental();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [autoTitle, setAutoTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('autre');
  const [property, setProperty] = useState<string>(defaults?.property_id ?? '');
  const [lease, setLease] = useState<string>(defaults?.lease_id ?? '');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setFile(null); setTitle(''); setAutoTitle(''); setError(null); setCategory('autre'); if (input.current) input.current.value = ''; };
  return (
    <Modal open={open} title="Ajouter un document" onClose={() => { reset(); onClose(); }}
      footer={<><Button onClick={() => { reset(); onClose(); }}>Annuler</Button><Button variant="primary" disabled={!file || !title.trim() || busy} onClick={async () => {
        if (!file) return;
        setBusy(true);
        const row = await upload(file, { title: title.trim(), category, property_id: property || null, lease_id: lease || null, shared_with_tenant: !!lease && shared });
        setBusy(false);
        if (row) { store.notify('Document ajouté.'); reset(); onClose(); }
      }}>{busy ? 'Envoi…' : 'Ajouter'}</Button></>}>
      <div className="grid">
        <div className="field field-full">
          <label htmlFor="doc-file">Fichier</label>
          <input id="doc-file" ref={input} type="file" accept={Object.keys(ALLOWED_TYPES).join(',') + ',.heic'} onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            const bad = f ? checkFile(f) : null;
            setError(bad);
            setFile(f && !bad ? f : null);
            // titre proposé à partir du nom de fichier, sans écraser un titre saisi à la main
            if (f && !bad && (!title || title === autoTitle)) { const t = f.name.replace(/\.[^.]+$/, ''); setTitle(t); setAutoTitle(t); }
          }} />
          <small className={error ? 'field-error' : 'muted'}>{error ?? 'PDF, JPEG, PNG, WebP, HEIC, Word, Excel ou texte ; 10 Mo maximum.'}</small>
        </div>
        <TextInput label="Titre" required wide value={title} onChange={setTitle} maxLength={200} />
        <Select label="Catégorie" value={category} onChange={(v) => setCategory(v ?? 'autre')} options={Object.entries(DOC_CATEGORY_LABELS) as [DocumentCategory, string][]} />
        <Select label="Bien" value={property || null} onChange={(v) => { setProperty(v ?? ''); setLease(''); }} allowEmpty="Aucun"
          options={store.data.properties.filter((p) => p.status === 'acquis' || p.id === defaults?.property_id).map((p) => [p.id, p.title] as const)} />
        <Select label="Bail" value={lease || null} onChange={(v) => setLease(v ?? '')} allowEmpty="Aucun"
          options={store.data.leases.filter((l) => !property || l.property_id === property).map((l) => [l.id, leaseLabel(l)] as const)} />
        {lease && <Checkbox label="Visible dans l’espace locataire" checked={shared} onChange={setShared} />}
      </div>
    </Modal>
  );
}
