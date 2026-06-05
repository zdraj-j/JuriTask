/**
 * JuriTask — icons.js
 * Integración de Lucide. La app genera mucho HTML dinámico vía innerHTML,
 * por lo que en lugar de llamar lucide.createIcons() en cada punto de render
 * usamos un MutationObserver con debounce que materializa cualquier
 * <i data-lucide="..."> recién insertado en el DOM.
 *
 * lucide.createIcons() reemplaza el <i> por un <svg> (que ya no coincide con
 * [data-lucide]), de modo que la operación converge y no entra en bucle.
 */
(function () {
  let scheduled = false;

  function runCreate() {
    scheduled = false;
    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  // Refresco manual (por si algún flujo necesita forzarlo de inmediato).
  window.refreshIcons = function () {
    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  };

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // requestAnimationFrame agrupa múltiples mutaciones del mismo frame.
    (window.requestAnimationFrame || window.setTimeout)(runCreate);
  }

  function start() {
    // Render inicial de los iconos presentes en el HTML estático.
    runCreate();

    if (!('MutationObserver' in window)) return;
    const obs = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.addedNodes && m.addedNodes.length) { schedule(); return; }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
