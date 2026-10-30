import type { MetadataRoute } from 'next';

/** Nothing on this site is for search engines. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
