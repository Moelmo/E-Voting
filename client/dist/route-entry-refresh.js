(() => {
  const dashboardRoutes = new Set(['/admin/overview', '/voting']);
  let currentPath = window.location.pathname;

  const reloadOnEntry = (previousPath, nextPath) => {
    const enteringDashboard = dashboardRoutes.has(nextPath) && !dashboardRoutes.has(previousPath);
    currentPath = nextPath;
    if (enteringDashboard) window.location.reload();
  };

  for (const method of ['pushState', 'replaceState']) {
    const original = window.history[method];
    window.history[method] = function (...args) {
      const previousPath = window.location.pathname;
      const result = original.apply(this, args);
      reloadOnEntry(previousPath, window.location.pathname);
      return result;
    };
  }

  window.addEventListener('popstate', () => {
    reloadOnEntry(currentPath, window.location.pathname);
  });
})();