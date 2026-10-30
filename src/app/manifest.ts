import type { MetadataRoute } from 'next';

/** Lets a phone add the site to its home screen as an app-like icon (Chrome: menu, "Add to Home screen"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'एक ज़िंदगी · EK ZINDAGI',
    short_name: 'एक ज़िंदगी',
    description: 'Road safety awareness certificates',
    start_url: '/new',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0d2150',
    theme_color: '#0d2150',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
