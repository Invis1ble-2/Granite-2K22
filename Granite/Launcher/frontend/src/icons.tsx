// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
import React from 'react';

export const IconPlay: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M6.1 4.28C6.1 3.53 6.91 3.07 7.56 3.46L16.22 8.68C16.84 9.05 16.84 9.95 16.22 10.32L7.56 15.54C6.91 15.93 6.1 15.47 6.1 14.72V4.28Z"
      fill="currentColor"
    />
  </svg>
);

export const IconNetwork: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="6.85" stroke="currentColor" strokeWidth="1.55" />
    <ellipse cx="10" cy="10" rx="3.1" ry="6.85" stroke="currentColor" strokeWidth="1.45" />
    <path d="M3.45 10H16.55" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
  </svg>
);

export const IconSliders: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M3.25 5.75H16.75M3.25 10H16.75M3.25 14.25H16.75" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
    <circle cx="7.3" cy="5.75" r="1.95" fill="var(--bg-card-solid)" stroke="currentColor" strokeWidth="1.55" />
    <circle cx="12.9" cy="10" r="1.95" fill="var(--bg-card-solid)" stroke="currentColor" strokeWidth="1.55" />
    <circle cx="8.4" cy="14.25" r="1.95" fill="var(--bg-card-solid)" stroke="currentColor" strokeWidth="1.55" />
  </svg>
);

export const IconSun: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="3.35" stroke="currentColor" strokeWidth="1.55" />
    <path
      d="M10 2.6V4.3M10 15.7V17.4M17.4 10H15.7M4.3 10H2.6M15.23 4.77L14.03 5.97M5.97 14.03L4.77 15.23M15.23 15.23L14.03 14.03M5.97 5.97L4.77 4.77"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
    />
  </svg>
);

export const IconMoon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M15.8 12.48A6.3 6.3 0 0 1 7.52 4.2a6.35 6.35 0 1 0 8.28 8.28Z"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconLanguage: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M3.1 5.35H11.35M7.25 3.4V5.35M9.55 5.35C9.05 8.28 7.15 10.9 4.1 12.4M5.85 8.55C6.88 10.08 8.38 11.38 10.2 12.2"
      stroke="currentColor"
      strokeWidth="1.48"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10.7 16.35L13.65 9.25L16.6 16.35M11.6 14.3H15.7"
      stroke="currentColor"
      strokeWidth="1.48"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconFolder: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M3.1 5.75C3.1 4.87 3.82 4.15 4.7 4.15H7.7C8.14 4.15 8.56 4.34 8.86 4.66L9.82 5.68H15.3C16.18 5.68 16.9 6.4 16.9 7.28V14.25C16.9 15.13 16.18 15.85 15.3 15.85H4.7C3.82 15.85 3.1 15.13 3.1 14.25V5.75Z"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconChevron: React.FC<{ className?: string; expanded?: boolean }> = ({ className, expanded }) => (
  <svg
    className={className}
    style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)' }}
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
  >
    <path d="M5.4 7.7L10 12.3L14.6 7.7" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconCopy: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="7" y="6.5" width="9" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M13 6.5V5.25C13 4.28 12.22 3.5 11.25 3.5H5.75C4.78 3.5 4 4.28 4 5.25V12.25C4 13.22 4.78 14 5.75 14H7"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

export const IconCheck: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M4.4 10.35L8.15 14.1L15.65 6.15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconTerminal: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6.1 7.6L8.7 10L6.1 12.4M10.4 12.4H13.8" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconBolt: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M11.1 2.75L4.7 10.75H9.65L8.9 17.25L15.3 9.25H10.35L11.1 2.75Z"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconCpu: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="5.1" y="5.1" width="9.8" height="9.8" rx="2.1" stroke="currentColor" strokeWidth="1.55" />
    <rect x="7.8" y="7.8" width="4.4" height="4.4" rx="0.9" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M7.6 2.8V5.1M12.4 2.8V5.1M7.6 14.9V17.2M12.4 14.9V17.2M2.8 7.6H5.1M2.8 12.4H5.1M14.9 7.6H17.2M14.9 12.4H17.2"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
    />
  </svg>
);

export const IconFileConfig: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M5.4 3.25H11.6L15.25 6.9V15.35C15.25 16.12 14.62 16.75 13.85 16.75H5.4C4.63 16.75 4 16.12 4 15.35V4.65C4 3.88 4.63 3.25 5.4 3.25Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M11.35 3.4V7.15H15.1" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
    <path d="M6.8 10.35H12.4M6.8 13.15H10.6" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
  </svg>
);

export const IconServer: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="3.2" y="3.7" width="13.6" height="5.1" rx="1.7" stroke="currentColor" strokeWidth="1.5" />
    <rect x="3.2" y="11.2" width="13.6" height="5.1" rx="1.7" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="6.1" cy="6.25" r="0.9" fill="currentColor" />
    <circle cx="6.1" cy="13.75" r="0.9" fill="currentColor" />
    <path d="M11.2 6.25H14.1M11.2 13.75H14.1" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
  </svg>
);

export const IconShield: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M10 2.85L15.85 5.05V9.65C15.85 13.3 13.42 16.15 10 17.35C6.58 16.15 4.15 13.3 4.15 9.65V5.05L10 2.85Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M7.6 10.1L9.25 11.75L12.65 8.2" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconRotateCcw: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M4.1 6.75H8.35M4.1 6.75V2.5M4.1 6.75L6.1 4.85A6.4 6.4 0 1 1 4.2 11.8" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconArrowRight: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M4.5 10H15.2M11.1 5.8L15.4 10L11.1 14.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconRadio: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="2.2" fill="currentColor" />
    <path d="M6.4 6.4A5.1 5.1 0 0 0 6.4 13.6M13.6 6.4A5.1 5.1 0 0 1 13.6 13.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M4.05 4.05A8.4 8.4 0 0 0 4.05 15.95M15.95 4.05A8.4 8.4 0 0 1 15.95 15.95" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const IconSteam: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="15.4" cy="8.6" r="3.85" stroke="currentColor" strokeWidth="1.75" />
    <circle cx="15.4" cy="8.6" r="1.5" fill="currentColor" />
    <circle cx="8.8" cy="15.2" r="2.55" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="8.8" cy="15.2" r="0.95" fill="currentColor" />
    <path
      d="M12.68 5.88L6.98 13.38M18.12 11.32L10.62 17.02"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
    />
    <path d="M2.55 12.35L6.42 14.12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export const CourtBlueprintSvg: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 420 220" fill="none" aria-hidden="true">
    {/* Outer Baseline & Sidelines */}
    <rect x="18" y="14" width="384" height="192" rx="4" stroke="currentColor" strokeWidth="1.5" />
    {/* Half-court division & center circle on left */}
    <line x1="18" y1="14" x2="18" y2="206" stroke="currentColor" strokeWidth="1.5" />
    <path d="M18 72A38 38 0 0 1 18 148" stroke="currentColor" strokeWidth="1.5" />
    <path d="M18 94A16 16 0 0 1 18 126" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 3" />
    {/* Right-side Three-Point Arc & Corner Lines */}
    <line x1="402" y1="34" x2="338" y2="34" stroke="currentColor" strokeWidth="1.5" />
    <line x1="402" y1="186" x2="338" y2="186" stroke="currentColor" strokeWidth="1.5" />
    <path d="M338 34A94 94 0 0 0 338 186" stroke="currentColor" strokeWidth="1.6" />
    {/* Paint / Key Lane */}
    <rect x="286" y="74" width="116" height="72" stroke="currentColor" strokeWidth="1.5" />
    {/* Free-throw Circle (Solid + Dashed) */}
    <path d="M286 74A36 36 0 0 0 286 146" stroke="currentColor" strokeWidth="1.5" />
    <path d="M286 74A36 36 0 0 1 286 146" stroke="currentColor" strokeWidth="1.35" strokeDasharray="4 4" />
    {/* Restricted Area Arc, Backboard & Rim */}
    <line x1="382" y1="92" x2="382" y2="128" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="373" cy="110" r="6.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M373 84A26 26 0 0 0 373 136" stroke="currentColor" strokeWidth="1.4" />
    {/* Lane Hash Marks */}
    <line x1="322" y1="70" x2="322" y2="74" stroke="currentColor" strokeWidth="1.4" />
    <line x1="344" y1="70" x2="344" y2="74" stroke="currentColor" strokeWidth="1.4" />
    <line x1="364" y1="70" x2="364" y2="74" stroke="currentColor" strokeWidth="1.4" />
    <line x1="322" y1="146" x2="322" y2="150" stroke="currentColor" strokeWidth="1.4" />
    <line x1="344" y1="146" x2="344" y2="150" stroke="currentColor" strokeWidth="1.4" />
    <line x1="364" y1="146" x2="364" y2="150" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);
