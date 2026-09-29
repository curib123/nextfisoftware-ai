'use client';
import { useId, type SVGProps } from 'react';
import { useSiteSettings } from '@/components/providers/site-settings-provider';

export function BrandMark(props: SVGProps<SVGSVGElement>) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      viewBox="0 0 96 72"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <defs>
        <linearGradient
          id={`${id}-bridge`}
          x1="24"
          y1="8"
          x2="72"
          y2="64"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#2563EB" />
          <stop offset=".52" stopColor="#0EA5A8" />
          <stop offset="1" stopColor="#14B8A6" />
        </linearGradient>
      </defs>
      <path
        d="M13 62V15C13 9.5 17.5 5 23 5H31V52C31 57.5 26.5 62 21 62H13Z"
        fill="#2563EB"
      />
      <path
        d="M27 8H38L70 52C74.2 57.8 70.1 66 63 66H52L20 22C15.8 16.2 19.9 8 27 8Z"
        fill={`url(#${id}-bridge)`}
      />
      <path
        d="M65 20C65 11.7 71.7 5 80 5H83V57C83 62 79 66 74 66H65V20Z"
        fill="#14B8A6"
      />
    </svg>
  );
}

export function BrandLockup({
  compact = false,
  inverted = false,
}: {
  compact?: boolean;
  inverted?: boolean;
}) {
  const { siteName, tagline } = useSiteSettings();
  return (
    <span className={`brand-lockup ${inverted ? 'brand-inverted' : ''}`}>
      <BrandMark
        className={compact ? 'brand-symbol compact' : 'brand-symbol'}
      />
      <span>
        <span className={compact ? 'brand-name compact' : 'brand-name'}>
          {siteName}
        </span>
        {!compact && <span className="brand-tagline">{tagline}</span>}
      </span>
    </span>
  );
}
