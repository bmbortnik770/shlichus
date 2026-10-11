import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// הממשק החדש — נפרס לצד הקיימים: /shlichus/app/
export default defineConfig({
  base: '/shlichus/app/',
  plugins: [react()],
});
