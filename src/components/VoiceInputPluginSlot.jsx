import React, { useEffect, useRef } from 'react';
import { message } from 'antd';
import { apiUrl } from '../utils/apiUrl';
import { t } from '../i18n';

function appendTextToInput(inputRef, text) {
  if (!text || !inputRef?.current) return;
  const ta = inputRef.current;
  const existing = ta.value;
  ta.value = existing ? `${existing}${text}` : text;
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

export default function VoiceInputPluginSlot({ plugin, inputRef, overlayContainerRef = null, className = '' }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !plugin?.file) return undefined;

    let cleanup = null;
    let cancelled = false;

    async function mountPlugin() {
      try {
        const moduleUrl = apiUrl(`/api/plugins/module?file=${encodeURIComponent(plugin.file)}&v=${encodeURIComponent(plugin.moduleVersion || Date.now())}`);
        const mod = await import(/* @vite-ignore */ moduleUrl);
        const mountVoiceInput = mod.mountVoiceInput;
        if (typeof mountVoiceInput !== 'function') {
          throw new Error('Plugin did not export mountVoiceInput(...)');
        }
        if (cancelled) return;
        const result = await mountVoiceInput({
          container,
          host: {
            inputRef,
            overlayContainer: overlayContainerRef?.current || null,
            plugin,
            apiUrl,
            appendText: (text) => appendTextToInput(inputRef, text),
            notifyError: (text) => message.error(text),
            notifyWarning: (text) => message.warning(text),
            t,
          },
        });
        if (typeof result === 'function') cleanup = result;
        else if (result && typeof result.dispose === 'function') cleanup = () => result.dispose();
      } catch (err) {
        if (!cancelled) {
          message.error(t('ui.plugins.clientLoadFailed', {
            name: plugin.name || plugin.file,
            reason: err.message,
          }));
        }
      }
    }

    mountPlugin();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
      if (container) container.innerHTML = '';
    };
  }, [plugin, inputRef, overlayContainerRef]);

  if (!plugin) return null;
  return <div ref={containerRef} className={className} />;
}
