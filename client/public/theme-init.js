// Runs before the page paints, so a dark theme does not flash light first.
// Same rules as client/src/lib/theme.ts.
(function () {
  var choice = 'auto';
  try {
    choice = localStorage.getItem('theme') || (localStorage.getItem('darkMode') === 'true' ? 'dark' : 'auto');
  } catch (e) { /* storage blocked */ }
  var dark = choice === 'dark' || (choice === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
