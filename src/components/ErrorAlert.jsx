import React from 'react';
import { X } from 'lucide-react';

export default function ErrorAlert({ id, error, onDismiss }) {
  if (!error) return null;

  const message = typeof error === 'string' ? error : error.message;
  if (!message) return null;
  const httpSwitchUrl = typeof error === 'object' ? error.httpSwitchUrl : null;

  return (
    <div id={id} className="error" role="alert">
      <div className="error-body">
        <span>{message}</span>
        {httpSwitchUrl && (
          <a href={httpSwitchUrl} className="error-action-link">
            Open HTTP version
          </a>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="alert-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss error"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
