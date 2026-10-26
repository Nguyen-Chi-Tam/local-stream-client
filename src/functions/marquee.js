// Lightweight marquee helper: wrap overflowing text in a `.marquee-inner` span
// and toggle `.marquee` on the container when overflow is detected.
export function applyMarqueeIfOverflow(selector, forceOnOverflow = false) {
  if (!document || !selector) return;
  document.querySelectorAll(selector).forEach((el) => {
    if (!(el instanceof HTMLElement)) return;

    // Prefer an existing inner element if present
    let inner = el.querySelector('.marquee-inner');
    if (!inner) {
      inner = document.createElement('span');
      inner.className = 'marquee-inner';
      while (el.firstChild) inner.appendChild(el.firstChild);
      el.appendChild(inner);
    }

    // Temporarily remove marquee to measure actual content overflow
    const wasMarquee = el.classList.contains('marquee');
    el.classList.remove('marquee');
    
    // Ensure measurement uses layout values
    const isOverflowing = inner.scrollWidth > el.clientWidth + 1;

    // Determine if the container is styled as a single-line truncated element
    const cs = window.getComputedStyle(el);
    const whiteSpace = (cs.whiteSpace || '').toLowerCase();
    const overflowX = (cs.overflowX || cs.overflow || '').toLowerCase();
    const textOverflow = (cs.textOverflow || '').toLowerCase();

    const isNowrap = whiteSpace.includes('nowrap');
    const isOverflowHidden = overflowX.includes('hidden') || overflowX.includes('clip') || (cs.overflow || '').includes('hidden');
    const isEllipsis = textOverflow.includes('ellipsis');

    let isSingleLineByHeight = false;
    try {
      let lh = parseFloat(cs.lineHeight);
      if (Number.isNaN(lh) || !isFinite(lh)) {
        const fs = parseFloat(cs.fontSize) || 14;
        lh = fs * 1.2;
      }
      isSingleLineByHeight = el.clientHeight <= Math.ceil(lh * 1.5);
    } catch (e) {
      isSingleLineByHeight = false;
    }

    const isSingleLineStyle = isNowrap || isEllipsis || isOverflowHidden || isSingleLineByHeight;
    const needsMarquee = forceOnOverflow ? isOverflowing : (isOverflowing && isSingleLineStyle);

    if (needsMarquee) {
      const durationSec = Math.max(6, Math.round(inner.scrollWidth / 40));
      inner.style.animationDuration = `${durationSec}s`;
      el.classList.add('marquee');
    } else {
      el.classList.remove('marquee');
      inner.style.animationDuration = '';
    }
  });
}

export function initMarquee(selectors = [], forceOnOverflow = false) {
  if (typeof window === 'undefined') return () => {};
  const sel = Array.isArray(selectors) ? selectors.join(',') : String(selectors);
  const handler = () => applyMarqueeIfOverflow(sel, forceOnOverflow);

  handler();
  window.addEventListener('resize', handler, { passive: true });

  const bodyObserver = new MutationObserver(handler);
  try {
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}

  const timeouts = [100, 300, 700, 1500].map((t) => window.setTimeout(handler, t));

  return () => {
    window.removeEventListener('resize', handler);
    try {
      bodyObserver.disconnect();
    } catch (e) {}
    timeouts.forEach((id) => window.clearTimeout(id));
  };
}

export default {
  applyMarqueeIfOverflow,
  initMarquee,
};
