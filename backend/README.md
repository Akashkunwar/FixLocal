# FixLocal backend

Express 5 + TypeORM + PostgreSQL API. Setup, configuration, testing and the security model are in the main [README](../README.md).

```bash
cp .env.example .env
npm install
npm run db:migrate     # existing pre-migration database? run `npm run db:baseline` first
npm run seed           # demo accounts (password: SEED_PASSWORD, default Password123!)
npm run dev            # http://localhost:3001
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start with reload |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm test` / `npm run test:coverage` | API test suites (uses `fixlocal_test`, never the dev database) |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run db:migrate` / `npm run db:revert` | Apply / undo migrations |
| `npm run migration:generate` / `migration:create` | New migration from entity changes / empty migration |
| `npm run db:baseline` | One-time step for databases created by the old `synchronize` option |
| `npm run db:reset-e2e` | Recreate a throwaway `*_e2e` / `*_test` database (refuses any other name) |
