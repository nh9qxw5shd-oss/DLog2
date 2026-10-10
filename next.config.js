// DLog2 is mounted under /log on the Derby Control hub (PotatOS), which proxies /log/* to this
// deployment. basePath keeps every route, asset and API under that prefix on the standalone
// hostname too, so the same build serves both. NEXT_PUBLIC_BASE_PATH is exposed for the places
// that build a URL by hand (lib/basePath.ts, the pdf.js worker).
const BASE_PATH = '/log'

// Top-level pages that existed before the mount (bookmarks, e.g. maintenance's /out-of-use link).
const PAGES = 'out-of-use|import|settings'

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: BASE_PATH,
  env: { NEXT_PUBLIC_BASE_PATH: BASE_PATH },
  async redirects() {
    return [
      { source: '/', destination: BASE_PATH, basePath: false, permanent: false },
      { source: `/:page(${PAGES})`, destination: `${BASE_PATH}/:page`, basePath: false, permanent: false },
      { source: `/:page(${PAGES})/:rest*`, destination: `${BASE_PATH}/:page/:rest*`, basePath: false, permanent: false },
    ]
  },
  async rewrites() {
    // The ESR routes are called from outside the browser at their pre-mount paths
    // (scripts/nrsdb_push.py → /api/esr/ingest, the keep-alive scheduler → /api/esr/keepalive).
    // A redirect would turn a POST into a GET or drop its body, so these are rewritten instead,
    // with method, headers, body and query intact. Next.js only allows a rewrite outside the
    // basePath to an absolute URL, so the request is proxied to the same host under the prefix.
    return [
      {
        source: '/api/:path*',
        has: [{ type: 'host', value: '(?<host>.+)' }],
        destination: `https://:host${BASE_PATH}/api/:path*`,
        basePath: false,
      },
    ]
  },
}
module.exports = nextConfig
