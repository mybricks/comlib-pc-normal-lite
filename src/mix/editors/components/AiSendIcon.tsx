import React, { useId } from 'react';

export function AiSendIcon({ disabled = false, size }: { disabled?: boolean; size?: number }) {
  const gradientId = useId();

  return (
    <svg
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="ai-send-icon-svg"
      width={size}
      height={size}
    >
      {!disabled && (
        <defs>
          <linearGradient id={gradientId} x1="512" y1="170.666667" x2="512" y2="853.333333" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#EEF2FF" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M554.666667 333.994667V853.333333h-85.333334V333.994667l-228.864 228.864-60.330666-60.330667L512 170.666667l331.861333 331.861333-60.330666 60.330667L554.666667 333.994667z"
        fill={disabled ? 'currentColor' : `url(#${gradientId})`}
      />
    </svg>
  );
}
