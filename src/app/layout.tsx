import type { Metadata } from 'next'
import { Inter, Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'InvoiceFlow AI — Intelligent AP Automation',
  description: 'AI-powered invoice processing and accounts payable automation. Extract, match, and approve invoices in seconds.',
  keywords: ['invoice processing', 'accounts payable', 'AI automation', 'DynamoDB', 'AWS'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} font-body bg-ink text-snow antialiased`}>
        {children}
      </body>
    </html>
  )
}
