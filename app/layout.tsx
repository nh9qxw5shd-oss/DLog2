import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'EMCC Daily Log | Network Rail',
  description: 'East Midlands Control Centre Daily Operations Report Generator',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="scanlines min-h-screen">
        {children}
      </body>
    </html>
  )
}
