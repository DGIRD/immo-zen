import { useEffect, useState } from 'react';
import { describeError, type PortalAccount, type PortalDocument, type PortalReceipt } from '../data/repo.ts';
import { useStore } from '../data/store.tsx';
import { buildReceiptPdf } from '../../supabase/functions/_shared/receiptPdf.ts';
import { date, money2 } from '../domain/format.ts';
import { monthLabel } from '../domain/rental.ts';
import { portalPreview, readInviteCode, rememberInviteCode } from '../domain/tenantPortal.ts';
import { downloadBlob } from '../domain/exporting.ts';
import { Button, EmptyState, PageHeader, Section } from '../ui/components.tsx';
import { href, navigate } from '../ui/router.ts';
import { DOC_CATEGORY_LABELS, size } from './rental/Documents.tsx';
import type { DocumentCategory } from '../data/types.ts';

async function downloadReceipt(r: PortalReceipt) {
  const lib = await import('pdf-lib');
  const bytes = await buildReceiptPdf(lib, { ...r, charges_label: r.charges_mode === 'forfait' ? 'Forfait de charges' : 'Provision pour charges' });
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${r.kind === 'quittance' ? 'quittance' : 'recu'}-${r.number}-${r.period_start.slice(0, 7)}.pdf`);
}

/** Contenu d'un espace locataire : logement, quittances et documents partagés (lecture seule). */
export function PortalView({ account, preview }: { account: PortalAccount; preview?: boolean }) {
  const { repo, notify } = useStore();
  const open = async (d: PortalDocument) => {
    const w = window.open('', '_blank');
    try {
      const url = await repo.fileUrl(d.storage_path, 60);
      if (w) w.location.href = url; else location.href = url;
    } catch (e) { w?.close(); notify(describeError(e), 'error'); }
  };
  return (
    <>
      {account.leases.map((l) => (
        <Section key={l.id} title={l.property_title || 'Mon logement'} className="tenant-lease">
          <dl className="contract-kv">
            <div><dt>Adresse</dt><dd>{l.property_address || '—'}</dd></div>
            <div><dt>Bail</dt><dd>Location {l.furnished ? 'meublée' : 'vide'} depuis le {date(l.start_date)}{l.end_date ? `, jusqu’au ${date(l.end_date)}` : ''}</dd></div>
            <div><dt>Loyer</dt><dd>{money2(l.rent_hc)} + {money2(l.charges_amount)} de {l.charges_mode === 'forfait' ? 'forfait de charges' : 'provision sur charges'}, le {l.payment_day} de chaque mois</dd></div>
            <div><dt>Bailleur</dt><dd>{[l.landlord_name, l.landlord_address].filter(Boolean).join(', ') || '—'}</dd></div>
          </dl>
        </Section>
      ))}
      <Section title={`Quittances et reçus (${account.receipts.length})`}>
        {account.receipts.length === 0 ? <p className="muted">Aucune quittance pour le moment. Elles apparaissent ici dès que votre bailleur les émet.</p> : (
          <div className="dt-scroll"><table className="dt-table">
            <thead><tr><th>Période</th><th>Document</th><th>N°</th><th>Émis le</th><th className="num">Montant</th><th><span className="sr-only">Télécharger</span></th></tr></thead>
            <tbody>{account.receipts.map((r) => (
              <tr key={r.id}>
                <td>{monthLabel(r.period_start)}</td><td>{r.kind === 'quittance' ? 'Quittance de loyer' : 'Reçu de paiement partiel'}</td><td>{r.number}</td>
                <td>{date(r.issued_on)}</td><td className="num">{money2(r.paid_amount)}</td>
                <td><Button size="sm" onClick={() => void downloadReceipt(r)}>Télécharger (PDF)</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
      <Section title={`Documents partagés (${account.documents.length})`}>
        {account.documents.length === 0 ? <p className="muted">Aucun document partagé par votre bailleur.</p> : (
          <div className="dt-scroll"><table className="dt-table">
            <thead><tr><th>Document</th><th>Catégorie</th><th>Ajouté le</th><th className="num">Taille</th><th><span className="sr-only">Ouvrir</span></th></tr></thead>
            <tbody>{account.documents.map((d) => (
              <tr key={d.id}>
                <td>{d.title}</td><td>{DOC_CATEGORY_LABELS[d.category as DocumentCategory] ?? d.category}</td><td>{date(d.created_at.slice(0, 10))}</td>
                <td className="num">{size(d.size_bytes)}</td><td><Button size="sm" onClick={() => void open(d)}>Ouvrir</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
      {!preview && <p className="muted small">Espace en lecture seule. Pour toute question sur votre bail ou vos paiements, contactez votre bailleur.</p>}
    </>
  );
}

/** Aperçu, par le bailleur, de l'espace d'un de ses locataires. */
export function TenantPreviewPage({ tenantId }: { tenantId: string }) {
  const { data } = useStore();
  const t = data.tenants.find((x) => x.id === tenantId);
  if (!t) return <EmptyState title="Locataire introuvable" action={<Button onClick={() => navigate('/locataires?onglet=locataires')}>Locataires</Button>} />;
  const account = portalPreview(t, data);
  return (
    <>
      <p className="crumbs"><a href={href('/locataires?onglet=locataires')}>Locataires</a></p>
      <PageHeader title={`Aperçu de l’espace locataire : ${account.tenant_name}`} subtitle="Ce que votre locataire voit une fois connecté : son logement, ses quittances et les documents que vous partagez avec lui." />
      <p className="note">Aperçu : seuls les documents cochés « Partagé avec le locataire » (bail ou locataire) apparaissent. Les quittances annulées ne sont jamais visibles.</p>
      <PortalView account={account} preview />
    </>
  );
}

/** Espace du locataire connecté (compte invité par son bailleur). */
export function TenantPortalPage() {
  const { repo, portal, refreshPortal, session, signOut, data } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const code = readInviteCode();

  useEffect(() => {
    if (!code || accepting) return;
    setAccepting(true);
    repo.acceptTenantInvite(code)
      .then(async () => { rememberInviteCode(null); setError(null); await refreshPortal(); if (location.hash.includes('code=')) navigate('/espace-locataire'); })
      .catch((e) => { rememberInviteCode(null); setError(describeError(e)); })
      .finally(() => setAccepting(false));
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const accounts = portal?.accounts ?? [];
  const isLandlord = data.properties.length > 0 || data.leases.length > 0;
  return (
    <div className="tenant-shell">
      <header className="tenant-top">
        <a href={href('/espace-locataire')} className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true" className="brand-mark"><path d="M4 17 16 6l12 11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 26h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/><circle cx="16" cy="19" r="2.4" fill="currentColor"/></svg>
          <span>Immo-Zen</span>
        </a>
        <div className="row">
          {isLandlord && <Button size="sm" onClick={() => navigate('/')}>Mon espace bailleur</Button>}
          <span className="user-email">{session?.email}</span>
          <Button size="sm" onClick={() => void signOut()}>Déconnexion</Button>
        </div>
      </header>
      <main className="tenant-main" id="contenu">
        <PageHeader title="Mon espace locataire" subtitle="Vos quittances de loyer et les documents partagés par votre bailleur." />
        {accepting && <p className="muted" role="status">Ouverture de votre espace…</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {portal === undefined ? <p className="muted">Chargement…</p>
          : portal === null ? <p className="form-error">L’espace locataire n’est pas encore disponible sur ce service.</p>
          : accounts.length === 0 ? (
            <EmptyState title="Aucun espace locataire">
              Votre bailleur vous envoie une invitation par e-mail. Ouvrez le lien qu’elle contient en étant connecté avec la même adresse e-mail ({session?.email}).
            </EmptyState>
          ) : accounts.map((a) => (
            <div key={a.id}>
              {accounts.length > 1 && <h2>{a.tenant_name}</h2>}
              <PortalView account={a} />
            </div>
          ))}
      </main>
    </div>
  );
}
