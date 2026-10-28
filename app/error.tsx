'use client';

import { AlertTriangle } from 'lucide-react';

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto mt-24 max-w-lg card border-rose-200 p-6">
      <div className="flex items-center gap-2 text-rose-700">
        <AlertTriangle className="h-5 w-5" />
        <h1 className="font-semibold">Something went wrong</h1>
      </div>
      <p className="mt-3 text-sm text-gray-700">{error.message}</p>
      <button type="button" onClick={reset} className="btn-primary mt-5">
        Back to dashboard
      </button>
    </main>
  );
}
