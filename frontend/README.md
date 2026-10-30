# Test Manager — frontend

React (Vite) app for the Test Manager backend. See `../README.md` for the whole setup.

```bash
npm install
npm run dev        # http://localhost:5173; /api is proxied to the backend on http://localhost:4000
npm run build      # type-check, then build to dist/
```

`src/api.ts` is the only place the app talks to the backend. For a deployed build set
`VITE_API_URL` (see `.env.example`).
