import { usePlan, useStore } from './data/store.tsx';
import { PlanLock } from './ui/PlanLock.tsx';
import { FISCAL_PACK_PRICE } from './domain/plans.ts';
import { AuthPage, NewPasswordPage } from './pages/Auth.tsx';
import { ComingSoonPage } from './pages/ComingSoon.tsx';
import { ContactDetailPage, ContactsPage } from './pages/Contacts.tsx';
import { DashboardPage } from './pages/Dashboard.tsx';
import { FiscalPage } from './pages/Fiscal.tsx';
import { AdminPage } from './pages/Admin.tsx';
import { SubscriptionPage } from './pages/Subscription.tsx';
import { OwnedPage } from './pages/Owned.tsx';
import { PropertyDetailPage } from './pages/PropertyDetail.tsx';
import { PropertyFormPage } from './pages/PropertyForm.tsx';
import { ProspectionPage } from './pages/Prospection.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { SimulatorPage } from './pages/Simulator.tsx';
import { DocumentsPage } from './pages/rental/Documents.tsx';
import { ExpensesPage } from './pages/rental/Expenses.tsx';
import { LeaseDetailPage } from './pages/rental/LeaseDetail.tsx';
import { LeaseContractPage } from './pages/rental/LeaseContract.tsx';
import { TenantPortalPage, TenantPreviewPage } from './pages/TenantPortal.tsx';
import { readInviteCode, rememberInviteCode } from './domain/tenantPortal.ts';
import { LeaseFormPage, LeasesPage } from './pages/rental/Leases.tsx';
import { RentsPage } from './pages/rental/Rents.tsx';
import { Layout, NAV } from './ui/Layout.tsx';
import { EmptyState, Button, PageHeader } from './ui/components.tsx';
import { navigate, useRoute } from './ui/router.ts';

export function App() {
  const { session, authReady, data, sync, portal } = useStore();
  const plan = usePlan();
  const route = useRoute();
  const [a, b, c] = route.path;

  if (!authReady) return <div className="boot">Immo-Zen</div>;
  if (a === 'nouveau-mot-de-passe' && session) return <NewPasswordPage />;
  if (!session) {
    // invitation à l'espace locataire : le code est conservé pendant la création du compte
    if (a === 'espace-locataire') rememberInviteCode(readInviteCode());
    return <AuthPage />;
  }
  // espace locataire : invitation à accepter, ou compte sans activité de bailleur
  const tenantOnly = !!portal?.accounts.length && !data.properties.length && !data.leases.length && !data.tenants.length && sync.state !== 'loading';
  if ((a === 'espace-locataire' && b !== 'apercu') || (a !== 'espace-locataire' && readInviteCode()) || (!a && tenantOnly)) return <TenantPortalPage />;

  let active = 'dashboard';
  let page: React.ReactNode;
  const key = location.hash;

  if (!a) page = <DashboardPage />;
  else if (a === 'prospection') { active = 'prospection'; page = <ProspectionPage key={key} />; }
  else if (a === 'biens') { active = 'biens'; page = <OwnedPage />; }
  else if (a === 'bien' && b === 'nouveau') {
    const mode = route.query.get('mode') === 'owned' ? 'owned' : 'prospect';
    active = mode === 'owned' ? 'biens' : 'prospection';
    // bien en prospection : fiche et simulation saisies ensemble dans le simulateur
    page = mode === 'owned' ? <PropertyFormPage key={key} mode={mode} /> : <SimulatorPage key={key} />;
  } else if (a === 'bien' && b) {
    const p = data.properties.find((x) => x.id === b);
    active = p?.status === 'acquis' ? 'biens' : 'prospection';
    if (!p && sync.state === 'loading') page = <p className="muted">Chargement…</p>;
    // bien en prospection : sa fiche se modifie dans le simulateur (une seule saisie)
    else if (c === 'modifier' && p && p.status !== 'acquis') { active = 'prospection'; page = <SimulatorPage key={key} propertyId={b} scenarioId={p.primary_scenario_id ?? undefined} />; }
    else page = c === 'modifier' ? <PropertyFormPage key={key} id={b} mode="owned" /> : <PropertyDetailPage id={b} />;
  } else if (a === 'simulateur') {
    active = 'simulateur';
    if (b && !data.scenarios.some((s) => s.id === b) && sync.state === 'loading') page = <p className="muted">Chargement…</p>;
    else page = <SimulatorPage key={key} scenarioId={b} propertyId={route.query.get('bien') ?? undefined} />;
  } else if (a === 'contacts') { active = 'contacts'; page = b ? <ContactDetailPage key={b} id={b} /> : <ContactsPage />; }
  else if (a === 'parametres') { active = 'parametres'; page = <SettingsPage />; }
  else if (a === 'locataires') { active = 'locataires'; page = <LeasesPage key={key} tab={route.query.get('onglet') === 'locataires' ? 'locataires' : 'baux'} />; }
  else if (a === 'baux' && b === 'nouveau') { active = 'locataires'; page = <LeaseFormPage key={key} propertyId={route.query.get('bien') ?? undefined} />; }
  else if (a === 'baux' && b) {
    active = 'locataires';
    if (!data.leases.some((l) => l.id === b) && sync.state === 'loading') page = <p className="muted">Chargement…</p>;
    else page = c === 'modifier' ? <LeaseFormPage key={key} id={b} /> : c === 'contrat' ? <LeaseContractPage key={key} id={b} /> : <LeaseDetailPage id={b} />;
  }
  else if (a === 'baux') { active = 'locataires'; page = <LeasesPage key={key} />; }
  else if (a === 'loyers') { active = 'loyers'; page = <RentsPage />; }
  else if (a === 'depenses') { active = 'depenses'; page = <ExpensesPage key={key} propertyId={route.query.get('bien') ?? undefined} />; }
  else if (a === 'documents') { active = 'documents'; page = <DocumentsPage />; }
  else if (a === 'declaration' || a === 'synthese') {
    active = 'fiscal';
    page = plan.features.fiscal ? <FiscalPage /> : (
      <><PageHeader title="Déclaration fiscale" />
        <PlanLock title="Déclaration fiscale non incluse dans votre formule">Montants à reporter sur la 2044, la 2042 et la 2042-C-PRO (micro-foncier, réel, micro-BIC, LMNP au réel avec amortissements) et export Excel. Inclus dans la formule Pro, ou avec le pack fiscal ({FISCAL_PACK_PRICE} € pour 12 mois) en formule Essentiel ou Patrimoine. Vos loyers et dépenses restent consultables et exportables dans leurs rubriques.</PlanLock></>
    );
  }
  else if (a === 'abonnement') { active = 'abonnement'; page = <SubscriptionPage key={key} />; }
  else if (a === 'espace-locataire' && b === 'apercu' && c) { active = 'locataires'; page = <TenantPreviewPage tenantId={c} />; }
  else if (a === 'admin') { active = 'admin'; page = <AdminPage />; }
  else {
    const item = NAV.find((n) => n.path === `/${a}`);
    if (item?.plannedLot) { active = item.key; page = <ComingSoonPage item={item} />; }
    else page = <EmptyState title="Page introuvable" action={<Button onClick={() => navigate('/')}>Tableau de bord</Button>} />;
  }

  return <Layout active={active}>{page}</Layout>;
}
