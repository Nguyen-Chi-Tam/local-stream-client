import React, { useState, useRef, useEffect } from 'react';

/**
 * MarqueeText:
 * Displays text normally when it fits within its container.
 * When overflowing, it starts in place (filling the visible line), pauses for 1 second,
 * and then marquees continuously and seamlessly.
 */
export default function MarqueeText({
  text = '',
  className = '',
  onClick,
  title,
  enabled = true,
  separator = '•',
  as: Component = 'span',
  ...props
}) {
  const containerRef = useRef(null);
  const textMeasureRef = useRef(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [duration, setDuration] = useState(14);

  useEffect(() => {
    if (!enabled || !text) {
      setIsOverflowing(false);
      return;
    }

    const checkOverflow = () => {
      const container = containerRef.current;
      const measure = textMeasureRef.current;
      if (container && measure) {
        const containerWidth = container.clientWidth;
        const textWidth = measure.scrollWidth;
        const overflowing = textWidth > containerWidth + 2;
        setIsOverflowing(overflowing);
        if (overflowing) {
          const calculatedDuration = Math.max(10, Math.min(35, Math.round(textWidth / 35)));
          setDuration(calculatedDuration);
        }
      }
    };

    checkOverflow();
    const raf = requestAnimationFrame(checkOverflow);
    const timeout = setTimeout(checkOverflow, 200);

    window.addEventListener('resize', checkOverflow);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [text, enabled]);

  const content = (enabled && isOverflowing) ? (
    <span
      className="marquee-content"
      style={{
        animationDuration: `${duration}s`,
      }}
    >
      <span>{text}</span>
      <span className="marquee-separator">{separator}</span>
      <span>{text}</span>
      <span className="marquee-separator">{separator}</span>
    </span>
  ) : (
    <span className="marquee-static">{text}</span>
  );

  return (
    <Component
      ref={containerRef}
      className={`marquee-text-wrap ${(enabled && isOverflowing) ? 'is-marquee' : ''} ${className}`.trim()}
      onClick={onClick}
      title={title || text}
      {...props}
    >
      <span
        ref={textMeasureRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          visibility: 'hidden',
          height: 0,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          top: -9999,
          left: -9999,
        }}
      >
        {text}
      </span>
      {content}
    </Component>
  );
}

