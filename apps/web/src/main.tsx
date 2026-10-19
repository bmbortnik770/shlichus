import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';
import { startUpdateCheck } from './updateCheck';
import { applyThemeMode } from './themeMode';

applyThemeMode();

startUpdateCheck();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
