import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

// The app itself is a separate Next.js project (../frontend) not yet deployed anywhere
// real. https://latens.example is the same placeholder frontend/layout.tsx and
// frontend/lib/wagmi.ts already use for that reason — replace all three together once a
// domain exists.
const APP_URL = "https://latens.example";

const config: Config = {
  title: "Latens Documentation",
  tagline: "Confidential borrow-lend for Horizen",
  favicon: "img/favicon.png",

  future: {
    v4: true,
  },

  url: "https://docs.latens.example",
  baseUrl: "/",

  organizationName: "Viqtorhvayx",
  projectName: "Latens",

  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  // Same three families as frontend/app/layout.tsx (Newsreader, IBM Plex Sans, IBM Plex
  // Mono), loaded the plain-CSS way since this project doesn't have next/font's build-time
  // self-hosting — a separate project, a separate font-loading mechanism.
  stylesheets: [
    {
      href: "https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;1,400&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
      type: "text/css",
    },
  ],

  presets: [
    [
      "classic",
      {
        // routeBasePath '/' makes the docs plugin own the site root, so there's no
        // separate marketing homepage to keep in sync with the sidebar. src/pages/ has
        // been emptied out to match: a page there would otherwise collide with this at
        // the same route.
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/Viqtorhvayx/Latens/tree/main/docs-site/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/favicon.png",
    colorMode: {
      defaultMode: "dark",
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: "Latens",
      logo: {
        alt: "Latens",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Documentation",
        },
        {
          href: APP_URL,
          label: "Launch App",
          position: "right",
          className: "navbar-launch-app",
        },
        {
          href: "https://github.com/Viqtorhvayx/Latens",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Documentation",
          items: [
            { label: "Overview", to: "/" },
            { label: "Privacy model", to: "/privacy-model" },
            { label: "Proof system", to: "/proofs" },
            { label: "Status and limits", to: "/status" },
          ],
        },
        {
          title: "Protocol",
          items: [
            { label: "Launch App", href: APP_URL },
            { label: "Deployed contracts", to: "/deployment" },
          ],
        },
        {
          title: "Community",
          items: [
            { label: "GitHub", href: "https://github.com/Viqtorhvayx/Latens" },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Latens. Built for Horizen.`,
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ["solidity", "rust", "bash", "toml"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
