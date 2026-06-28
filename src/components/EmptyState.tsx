import type { ReactNode } from 'react';

/**
 * Completion Milestone E1: a small, presentational empty / first-run state. Shows a short
 * action-oriented message and optional "next action" buttons that switch views via existing
 * app state (no routing, no wizard). Purely presentational — it reads and mutates nothing.
 */

export type EmptyStateAction = {
  label: string;
  onClick: () => void;
  /** Render as the filled primary button (default false). */
  primary?: boolean;
};

export default function EmptyState({
  title,
  message,
  actions = [],
}: {
  title: string;
  message: ReactNode;
  actions?: EmptyStateAction[];
}) {
  return (
    <div className="empty-state-card">
      <h3 className="empty-state-title">{title}</h3>
      <div className="empty-state-message">{message}</div>
      {actions.length > 0 && (
        <div className="empty-state-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`empty-state-button ${action.primary ? 'empty-state-button-primary' : ''}`}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
