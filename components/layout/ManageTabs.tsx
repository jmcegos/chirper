'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { onOpenManageTab, type ManageTab } from '@/components/ui/uiEvents';

const TAB_KEY = 'manage-tab';

const TABS: Array<{ id: ManageTab; label: string }> = [
  { id: 'loans', label: 'Loans' },
  { id: 'income', label: 'Income' },
  { id: 'bills', label: 'Bills' },
  { id: 'card', label: 'Credit card' },
  { id: 'spending', label: 'Spending' },
];

function isManageTab(value: string | null): value is ManageTab {
  return TABS.some((tab) => tab.id === value);
}

/**
 * Loans, income, bills, card and spending in one card, one at a time.
 * Every panel stays mounted so a half-filled form survives a tab switch.
 */
export function ManageTabs({ panels }: { panels: Record<ManageTab, ReactNode> }) {
  const [active, setActive] = useState<ManageTab>('loans');
  const rootRef = useRef<HTMLElement>(null);

  const select = (tab: ManageTab) => {
    setActive(tab);
    try {
      window.localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* storage unavailable: the tab just isn't remembered */
    }
  };

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TAB_KEY);
      if (isManageTab(stored)) setActive(stored);
    } catch {
      /* storage unavailable: start on Loans */
    }
    return onOpenManageTab((tab) => {
      select(tab);
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  return (
    <section ref={rootRef} className="card scroll-mt-6 overflow-hidden">
      <div role="tablist" aria-label="Manage" className="flex gap-1 overflow-x-auto border-b border-gray-100 p-3 [scrollbar-width:none]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            className={active === tab.id ? 'tab tab-on shrink-0' : 'tab shrink-0'}
            onClick={() => select(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div key={tab.id} id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} hidden={active !== tab.id}>
          {panels[tab.id]}
        </div>
      ))}
    </section>
  );
}
