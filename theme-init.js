(() => {
  const storageKey = 'rounds-theme';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme() {
    const preference = localStorage.getItem(storageKey);
    const dark = preference === 'dark' || (preference !== 'light' && media.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#09090b' : '#ffffff';
  }

  applyTheme();
  media.addEventListener?.('change', () => {
    if (!localStorage.getItem(storageKey)) {
      applyTheme();
      window.dispatchEvent(new Event('rounds-theme-change'));
    }
  });
})();
