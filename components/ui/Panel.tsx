import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** One section of the Manage tabs: a heading row, then the content. The tab card supplies the frame. */
export function Panel({ title, subtitle, actions, children }: PanelProps) {
  return (
    <section>
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-gray-500">{subtitle}</p>}
        </div>
        {actions}
      </header>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}
