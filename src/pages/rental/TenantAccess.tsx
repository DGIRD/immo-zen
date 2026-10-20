import { useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { Tenant } from '../../data/types.ts';
import { dateTime } from '../../domain/format.ts';
import { tenantName } from '../../domain/rental.ts';
import { ACCESS_STATUS_LABELS, accessStatus, type AccessStatus } from '../../domain/tenantPortal.ts';
import { Button, Modal, Pill, useConfirm } from '../../ui/components.tsx';
import { navigate } from '../../ui/router.ts';

const TONE: Record<AccessStatus, 'neutral' | 'ok' | 'warn' | 'bad'> = { aucun: 'neutral', invite: 'warn', actif: 'ok', revoque: 'bad', expire: 'bad' };

/** Invitation et révocation de l'espace locataire, partagées par la liste des locataires et la fiche du bail. */
export function useTenantAccess() {
  const store = useStore();
  const { data, repo } = store;
  const { ask, dialog } = useConfirm();
  const [sent, setSent] = useState<{ tenant: Tenant; code: string; email: string } | null>(null);
  const statusOf = (t: Tenant) => {
    const a = data.tenantAccounts.find((x) => x.tenant_id === t.id);
    return { account: a, status: accessStatus(a) };
  };

  async function invite(t: Tenant) {
    if (!t.email) { store.notify('Renseignez l’adresse e-mail du locataire pour l’inviter (fiche locataire).', 'error'); return; }
    const { status } = statusOf(t);
    const again = status === 'invite' || status === 'actif' || status === 'expire';
    if (!(await ask(again ? 'Renvoyer l’invitation' : 'Inviter à l’espace locataire',
      <>{tenantName(t)} recevra à <strong>{t.email}</strong> un lien pour créer son compte et consulter, en lecture seule, ses quittances et les documents que vous partagez avec lui. {again ? 'L’invitation précédente ne sera plus valable.' : ''}</>,
      again ? 'Renvoyer' : 'Inviter', false))) return;
    const r = await store.call((x) => x.inviteTenant(t.id));
    if (r) setSent({ tenant: t, ...r });
  }
  async function revoke(t: Tenant) {
    if (!(await ask('Révoquer l’accès', `${tenantName(t)} ne pourra plus consulter son espace locataire. Vous pourrez l’inviter de nouveau plus tard.`, 'Révoquer'))) return;
    if ((await store.call((x) => x.revokeTenant(t.id))) !== null) store.notify('Accès à l’espace locataire révoqué.');
  }
  const actions = (t: Tenant) => {
    const { status } = statusOf(t);
    return [
      { label: status === 'aucun' || status === 'revoque' ? 'Inviter à l’espace locataire' : 'Renvoyer l’invitation', onSelect: () => void invite(t) },
      ...(status === 'invite' || status === 'actif' ? [{ label: 'Révoquer l’accès', danger: true, onSelect: () => void revoke(t) }] : []),
      { label: 'Aperçu de l’espace locataire', onSelect: () => navigate(`/espace-locataire/apercu/${t.id}`) },
    ];
  };
  const link = sent ? `${location.origin}${location.pathname}#/espace-locataire?code=${sent.code}` : '';
  const ui = (
    <>
      {dialog}
      <Modal open={!!sent} title="Invitation préparée" onClose={() => setSent(null)} footer={<Button variant="primary" onClick={() => setSent(null)}>Fermer</Button>}>
        {sent && <>
          <p>{repo.mode === 'demo'
            ? 'Mode démonstration : aucun e-mail n’est envoyé. En ligne, l’invitation part automatiquement par e-mail.'
            : <>L’invitation part par e-mail à <strong>{sent.email}</strong> dans les prochaines minutes (si l’envoi des e-mails est activé).</>}</p>
          <p>Vous pouvez aussi lui transmettre ce lien, valable 30 jours, uniquement avec son adresse e-mail :</p>
          <p className="code-line"><code>{link}</code> <Button size="sm" onClick={() => void navigator.clipboard?.writeText(link).then(() => store.notify('Lien copié.'))}>Copier</Button></p>
          <p className="muted small">Code d’invitation : <strong>{sent.code}</strong></p>
        </>}
      </Modal>
    </>
  );
  return { statusOf, invite, revoke, actions, ui };
}

export function AccessPill({ tenant }: { tenant: Tenant }) {
  const { data } = useStore();
  const a = data.tenantAccounts.find((x) => x.tenant_id === tenant.id);
  const s = accessStatus(a);
  return <span title={a?.accepted_at ? `Espace ouvert le ${dateTime(a.accepted_at)}` : a?.invited_at ? `Invité le ${dateTime(a.invited_at)}` : undefined}><Pill tone={TONE[s]}>{ACCESS_STATUS_LABELS[s]}</Pill></span>;
}
