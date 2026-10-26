'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { BillForm } from './BillForm';

export function AddBill() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn-primary w-full" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Add bill or planned expense
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-sky-500/30 bg-slate-950/60 p-3">
      <BillForm onDone={() => setOpen(false)} />
    </div>
  );
}
