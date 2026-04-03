import React, { useMemo } from 'react';
import { t } from '../i18n';
import styles from './ToolApprovalPanel.module.css';

function ToolApprovalPanel({ toolName, toolInput, requestId, onAllow, onDeny, visible }) {
  const displayText = useMemo(() => {
    if (!toolInput) return '';
    switch (toolName) {
      case 'Bash':
        return toolInput.command || '';
      case 'Edit':
        return toolInput.file_path || '';
      case 'Write':
        return toolInput.file_path || '';
      case 'NotebookEdit':
        return toolInput.notebook_path || '';
      default:
        return JSON.stringify(toolInput, null, 2).slice(0, 500);
    }
  }, [toolName, toolInput]);

  const detailText = useMemo(() => {
    if (!toolInput) return null;
    if (toolName === 'Bash' && toolInput.description) return toolInput.description;
    if (toolName === 'Edit' && toolInput.old_string != null) {
      const old = String(toolInput.old_string).slice(0, 80);
      const nw = String(toolInput.new_string).slice(0, 80);
      return `${old}  →  ${nw}`;
    }
    return null;
  }, [toolName, toolInput]);

  if (!visible) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.toolName}>{toolName}</span>
        <span className={styles.label}>{t('ui.permission.approvalRequired')}</span>
      </div>
      <div className={styles.body}>
        <pre className={styles.command}>{displayText}</pre>
        {detailText && <div className={styles.detail}>{detailText}</div>}
      </div>
      <div className={styles.actions}>
        <button className={styles.denyBtn} onClick={() => onDeny(requestId)}>
          {t('ui.permission.deny')}
        </button>
        <button className={styles.allowBtn} onClick={() => onAllow(requestId)}>
          {t('ui.permission.allow')}
        </button>
      </div>
    </div>
  );
}

export default ToolApprovalPanel;
