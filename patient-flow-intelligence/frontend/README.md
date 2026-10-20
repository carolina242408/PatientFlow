# frontend

React + Vite + TypeScript + Tailwind. Login via Keycloak (`src/auth`), chamadas à API via `src/api/axios.ts` (proxy `/api` → `localhost:8080`).

```bash
npm install
npm run dev     # http://localhost:5173
npm run lint
npm run build
```

Páginas em `src/pages`, layout em `src/layout`, traduções em `src/i18n` (pt-PT por defeito, en).
