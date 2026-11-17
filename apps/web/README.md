# Missive — back-office web

Vite + React 19 + TypeScript + Tailwind v4 + react-router + recharts.

```bash
npm install
npm run dev        # http://localhost:5173 (API attendue sur http://localhost:4000)
npm run build      # tsc -b && vite build
```

Variable : `VITE_API_URL` (défaut `http://localhost:4000`, voir `.env.example`).
Compte démo (après `npm run seed` dans `apps/api`) : `demo@missive.local` / `demo1234`.

Structure : `src/lib/api.ts` (client REST typé, jeton dans `localStorage`), `src/lib/types.ts` (modèle SPEC),
`src/components` (UI, layout, aperçu email, panneau modèles, graphiques), `src/pages` (une page par écran).
