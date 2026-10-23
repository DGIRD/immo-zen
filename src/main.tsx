import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { config, isDemoMode } from './config.ts';
import { createDemoRepo } from './data/demoRepo.ts';
import { createSupabaseRepo } from './data/supabaseRepo.ts';
import { StoreProvider } from './data/store.tsx';
import './styles.css';

const repo = isDemoMode() ? createDemoRepo() : createSupabaseRepo(config.supabaseUrl, config.supabaseAnonKey);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider repo={repo}>
      <App />
    </StoreProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && config.env !== 'development') {
  addEventListener('load', () => { void navigator.serviceWorker.register('service-worker.js'); });
  // Nouvelle version publiée : le nouveau service worker prend la main, la page se recharge une fois
  // pour utiliser tout de suite les nouveaux fichiers (sinon il fallait recharger deux fois).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}
