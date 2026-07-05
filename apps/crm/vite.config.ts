import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// נפרס לצד המערכת הישנה: /shlichus/v2/
export default defineConfig({
  base: '/shlichus/v2/',
  plugins: [react()],
});
