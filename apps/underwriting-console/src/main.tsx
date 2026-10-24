import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@console-runtime-app';
import { useNumberInputStepGuard } from './hooks/useNumberInputStepGuard';
import './index.css';

/**
 * The guard is mounted here rather than inside a runtime app because
 * `@console-runtime-app` resolves to App or ProtectedApp depending on the build
 * mode. Mounted in one of them, the other build silently rewrites income
 * figures on a stray scroll or arrow key.
 */
function ConsoleRoot() {
  useNumberInputStepGuard();
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConsoleRoot />
  </React.StrictMode>,
);
