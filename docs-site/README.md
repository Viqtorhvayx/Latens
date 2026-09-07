# Latens documentation

The standalone documentation site for [Latens](https://github.com/Viqtorhvayx/Latens), built
with [Docusaurus](https://docusaurus.io/). This is a separate project from `../frontend`
(the app itself): separate build, separate deploy, on purpose, so a docs change never risks
the app and an app change never risks the docs.

## Local development

```bash
npm install
npm start
```

Starts a dev server with hot reload, by default at `http://localhost:3000` (run alongside
`../frontend`'s own dev server, set to port 3001 in that project, so the two don't collide;
see `frontend/lib/docsUrl.ts`).

## Build

```bash
npm run build
```

Generates static output into `build/`, deployable to any static host.

## Content

All content lives in `docs/`, one file per topic, ordered by `sidebars.ts`. The deployed
contracts table on the [Deployment](./docs/deployment.mdx) page imports
`../frontend/lib/deployment.json` directly, so it can never drift out of sync with what the
app itself reads its own contract addresses from.
