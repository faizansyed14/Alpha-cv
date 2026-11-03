import type { Metadata } from "next";
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@fontsource-variable/inter/wght.css";
import "./globals.css";
import AuthInitializer from "@/components/auth/AuthInitializer";

export const metadata: Metadata = {
  title: "Alpha CV - AI-Powered Resume Matching",
  description: "Advanced CV-JD matching system with explainable AI results",
  icons: {
    icon: '/alphadatalogo.svg',
    shortcut: '/alphadatalogo.svg',
    apple: '/alphadatalogo.svg',
  },
  metadataBase: new URL('https://alphacv.alphadatarecruitment.ae'),
  openGraph: {
    title: "Alpha CV - AI-Powered Resume Matching",
    description: "Advanced CV-JD matching system with explainable AI results",
    url: "https://alphacv.alphadatarecruitment.ae",
    siteName: "Alpha CV",
    images: [
      {
        url: '/alphadatalogo.svg',
        width: 512,
        height: 512,
        alt: 'Alpha CV logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: "Alpha CV - AI-Powered Resume Matching",
    description: "Advanced CV-JD matching system with explainable AI results",
    images: ['/alphadatalogo.svg'],
  },
};

export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 5, themeColor: '#F6F8FB' };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="antialiased overflow-x-hidden">
        <AuthInitializer />
        {children}
      </body>
    </html>
  );
}
