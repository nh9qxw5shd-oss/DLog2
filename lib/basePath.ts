// The path prefix this app is served under (next.config.js `basePath`). Next.js adds it to
// <Link>, the router and its own assets; anything that builds a URL string by hand (fetch of an
// API route, a public file, the pdf.js worker, a raw <a href>) must add it here.

export const BASE_PATH: string = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/** Root-relative path ("/api/x") → served path ("/log/api/x"). Anything else is returned as is. */
export function withBase(path: string, base: string = BASE_PATH): string {
  return path.startsWith('/') && !path.startsWith('//') ? `${base}${path}` : path
}
