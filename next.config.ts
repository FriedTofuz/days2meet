import type { NextConfig } from 'next';

/**
 * The app serves only its own assets: fonts are self-hosted by `next/font`, the
 * one outbound link (github.com) opens in a new tab rather than embedding, and
 * there is no `dangerouslySetInnerHTML` anywhere. So the policy can be tight.
 *
 * `script-src`/`style-src` keep `'unsafe-inline'` because Next injects an inline
 * hydration bootstrap and critical CSS with no nonce here; that is the one
 * concession, and it costs little while the app has no injection sink to abuse
 * it. Moving to a per-request nonce is the natural next step if that changes.
 */
// Next's dev server evaluates modules with `eval` for hot reloading, which a
// strict `script-src` blocks. Allow it in development only — production builds
// ship no `eval`, so the deployed policy stays tight.
const isDev = process.env.NODE_ENV !== 'production';
const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'";

const contentSecurityPolicy = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Belt to the CSP's braces: frame-ancestors already refuses framing on modern
  // browsers, and this covers the ones that only understand the older header.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // An event link is a private capability, not a public page. Keep the slug
      // — and the names and title on the page — out of search results in case a
      // link is ever pasted somewhere a crawler can reach.
      {
        source: '/e/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default nextConfig;
