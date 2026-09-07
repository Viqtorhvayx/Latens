// The docs are a standalone Docusaurus site (../docs-site), built and deployed separately
// from this Next.js app rather than as one of its routes. Until a real domain exists this
// falls back to localhost, matching how docs-site's own dev server runs
// (`npm run start` in docs-site, default port 3001, kept distinct from this app's 3000 so
// both can run at once). Override with NEXT_PUBLIC_DOCS_URL once a docs subdomain exists.
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || "http://localhost:3001";
