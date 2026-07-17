# aims-commerce-backend — DEPRECATED

**This repo is no longer used. It was a sidecar for migration scripts and tests
that has been merged into the main monorepo.**

All API code, tests, and docs are now in:
**[github.com/muhallimir/aims-commerce](https://github.com/muhallimir/aims-commerce)**

In particular:
- API tests: `aims-commerce/scripts/test/e2e_test.mjs` (run via `npm run test:e2e`)
- Browser tests: `aims-commerce/scripts/test/browser_e2e_start_selling.mjs` (`npm run test:browser`)
- Chat tests: `aims-commerce/scripts/test/chat_test.mjs` (`npm run test:chat`)
- DB scan: `aims-commerce/scripts/test/scan_test_data.mjs` (`npm run test:scan`)
- Docs: `aims-commerce/docs/`

The Express server, Prisma client, Heroku Procfile, Dockerfile, and
migration scripts in this repo are all dead. The single Next.js
monorepo at github.com/muhallimir/aims-commerce is the only source
of truth.

**This repo will be deleted shortly.**
