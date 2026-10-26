import React, { useState } from 'react';

/**
 * AnimatedMediaButton:
 * Wraps media control buttons with directional animations matching tailwindcss-animated:
 * - direction="left": animate-fade-left (icon moves leftward)
 * - direction="right": animate-fade-right (icon moves rightward)
 * Triggers on every click with immediate restart.
 */
export default function AnimatedMediaButton({
  direction = 'left',
  onClick,
  children,
  className = '',
  ...props
}) {
  const [animId, setAnimId] = useState(0);

  const handleClick = (e) => {
    setAnimId((c) => c + 1);
    if (onClick) onClick(e);
  };

  const animClass = animId > 0
    ? (direction === 'left' ? 'animate-fade-left' : 'animate-fade-right')
    : '';

  return (
    <button
      {...props}
      className={`icon-button ${direction === 'left' ? 'media-btn-left' : 'media-btn-right'} ${className}`.trim()}
      onClick={handleClick}
    >
      <span
        key={animId}
        className={`media-icon-wrapper ${animClass}`}
      >
        {children}
      </span>
    </button>
  );
}
