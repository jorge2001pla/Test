import Script from "next/script";

const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('prc-theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;

export default function ThemeScript() {
  // The App Router explicitly supports beforeInteractive scripts placed in the root layout
  // (see Next.js docs, script.md) — this lint rule predates that and only checks for
  // pages/_document.js.
  return (
    // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document -- see above
    <Script id="prc-theme-init" strategy="beforeInteractive">
      {THEME_SCRIPT}
    </Script>
  );
}
