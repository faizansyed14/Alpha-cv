'use client';
import React from 'react';
export default function CareersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--app-bg)] flex flex-col">
      {/* ================= Main ================= */}
      <main className="flex-1">{children}</main>
      {/* ================= Footer ================= */}
      <footer className="bg-paper/90 border-t border-surface-border mt-auto backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-sm text-ink-muted">
            <p>&copy; {new Date().getFullYear()} CV Analyzer. All rights reserved.</p>
            <p className="mt-1">AI-powered recruitment and talent matching platform</p>
          </div>
        </div>
      </footer>
    </div>
  );
}