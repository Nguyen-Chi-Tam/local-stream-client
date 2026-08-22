import React from 'react';

/**
 * DynamicIslandWaveform
 * Thick, animated 5-bar audio waveform inspired by Apple's Dynamic Island.
 *
 * @param {boolean} isPlaying - When true, waveform bars actively bounce. When false, bars stay in calm resting state.
 * @param {string} className - Additional CSS classes.
 * @param {'sm' | 'md' | 'lg'} size - Size variant.
 * @param {string} color - Optional color / background override.
 * @param {React.CSSProperties} style - Optional inline styles.
 */
export default function DynamicIslandWaveform({
  isPlaying = true,
  className = '',
  size = 'md',
  color,
  style = {},
}) {
  const customStyle = {
    ...(color ? { '--waveform-color': color, '--waveform-bg': color } : {}),
    ...style,
  };

  return (
    <div
      className={`dynamic-island-waveform ${isPlaying ? 'is-playing' : 'is-paused'} size-${size} ${className}`.trim()}
      style={customStyle}
      aria-label={isPlaying ? 'Playing waveform' : 'Paused waveform'}
      aria-hidden="true"
    >
      <span className="waveform-bar bar-1" />
      <span className="waveform-bar bar-2" />
      <span className="waveform-bar bar-3" />
      <span className="waveform-bar bar-4" />
      <span className="waveform-bar bar-5" />
    </div>
  );
}
