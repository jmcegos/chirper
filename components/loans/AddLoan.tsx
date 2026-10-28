'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { LoanForm } from './LoanForm';

/** Sits in a wrapping header row: the button on the right, the open form on a full-width line of its own. */
export function AddLoan() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn-neutral" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Add loan
      </button>
    );
  }
  return (
    <div className="basis-full rounded-xl border border-gray-200 bg-gray-50 p-4 text-left">
      <LoanForm onDone={() => setOpen(false)} />
    </div>
  );
}
