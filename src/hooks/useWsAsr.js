/**
 * useWsAsr — 蚂蚁语音平台 WebSocket ASR Hook
 *
 * 使用浏览器原生 AudioContext + getUserMedia 采集 PCM，通过 WebSocket 实时上传识别。
 * Safari 兼容：getUserMedia 在用户点击时立即调用（用户手势上下文中）。
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { apiUrl } from '../utils/apiUrl';

const ASR_APPKEY = 'f3da547c48744b6a';
const ASR_WS_URL = 'wss://mediafeature.alipay.com:443';
const SAMPLE_RATE = 16000;

function getUUID(len = 32, radix = 16) {
  const chars = '0123456789abcdef';
  const uuid = [];
  for (let i = 0; i < len; i++) uuid.push(chars[Math.floor(Math.random() * radix)]);
  return uuid.join('');
}

function getSampleRate(rate) {
  const s = String(rate);
  if (['8', '8000'].includes(s)) return 'RATE_8000';
  if (['16', '16000'].includes(s)) return 'RATE_16000';
  if (['24', '24000'].includes(s)) return 'RATE_24000';
  if (['48', '48000'].includes(s)) return 'RATE_48000';
  return 'RATE_16000';
}

function getAsrPayload() {
  return {
    action: 'start',
    sdk_version: '1.0',
    sdk_language: 'javascript',
    format: 'PCM',
    sample_rate: getSampleRate(SAMPLE_RATE),
    task_id: getUUID(32, 16),
    api: 'STREAM_ASR',
    enable_punctuation: true,
    sample_size: 'BIT_16',
  };
}

/** Float32 → Int16 PCM little-endian ArrayBuffer */
function float32ToPcmBuffer(float32Array) {
  const buf = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buf;
}

/** 降采样 */
function downsample(buffer, fromRate, toRate) {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const len = Math.round(buffer.length / ratio);
  const result = new Float32Array(len);
  for (let i = 0; i < len; i++) result[i] = buffer[Math.round(i * ratio)] || 0;
  return result;
}

export function useWsAsr({ onChange, onCompleted, onError } = {}) {
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const isStoppedRef = useRef(false);
  const loadingTimerRef = useRef(null);
  const confirmedTextRef = useRef('');   // 已确认的累积文本
  const currentInterimRef = useRef('');  // 当前中间结果

  // 用 ref 保存最新回调，避免闭包陷阱
  const onChangeRef = useRef(onChange);
  const onCompletedRef = useRef(onCompleted);
  const onErrorRef = useRef(onError);
  onChangeRef.current = onChange;
  onCompletedRef.current = onCompleted;
  onErrorRef.current = onError;

  // ─── 停止音频采集（不关 WS） ───
  const stopCapture = useCallback(() => {
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch {}
      processorRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch {}
      sourceRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setIsRunning(false);
  }, []);

  // ─── 关闭所有资源 ───
  const closeAll = useCallback(() => {
    stopCapture();
    // 如果有未回写的累积文本，确保回调
    if (confirmedTextRef.current && isStoppedRef.current) {
      onCompletedRef.current?.(confirmedTextRef.current);
      confirmedTextRef.current = '';
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
    isStoppedRef.current = false;
    setIsLoading(false);
  }, [stopCapture]);

  // ─── 开始音频采集（stream 已获取，WS 已收到 start_ack） ───
  const startCapture = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (isStoppedRef.current) return;
        if (!wsRef.current || wsRef.current.readyState !== 1) return;
        const raw = e.inputBuffer.getChannelData(0);
        const resampled = downsample(raw, audioCtx.sampleRate, SAMPLE_RATE);
        wsRef.current.send(float32ToPcmBuffer(resampled));
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      setIsRunning(true);
      setIsLoading(false);
    } catch (err) {
      onErrorRef.current?.(`音频采集失败：${err.message}`);
      closeAll();
    }
  }, [closeAll, onError]);

  // ─── 停止（停采集 → 发 stop → 等 completed） ───
  const stop = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === 1 && !isStoppedRef.current) {
      isStoppedRef.current = true;
      stopCapture();
      wsRef.current.send(JSON.stringify({ action: 'stop', sdk_version: '1.0' }));
    } else {
      closeAll();
    }
  }, [closeAll, stopCapture]);

  // ─── 开始 ───
  const start = useCallback(async () => {
    if (isRunning || isLoading) return;
    setIsLoading(true);
    isStoppedRef.current = false;
    confirmedTextRef.current = '';
    currentInterimRef.current = '';

    loadingTimerRef.current = setTimeout(() => {
      setIsLoading(false);
      loadingTimerRef.current = null;
    }, 8000);

    try {
      // 1. 立即获取麦克风（在用户手势中，Safari 要求）
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 2. 获取签名
      const digestRes = await fetch(apiUrl('/api/asr-digest'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: ASR_APPKEY }),
      });
      const digestData = await digestRes.json();
      if (!digestData.success || !digestData.timeStamp || !digestData.digest) {
        throw new Error('获取签名失败');
      }

      // 3. 连接 WebSocket
      const qs = `Alipay-Mf-Appkey=${ASR_APPKEY}&Alipay-Mf-Timestamp=${digestData.timeStamp}&Alipay-Mf-Digest=${digestData.digest}`;
      const ws = new WebSocket(`${ASR_WS_URL}/asr?${qs}`);
      wsRef.current = ws;

      ws.onerror = () => {
        onErrorRef.current?.('WebSocket 连接失败');
        closeAll();
      };

      ws.onopen = () => {
        ws.send(JSON.stringify(getAsrPayload()));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { actionType, content } = data;
          switch (actionType) {
            case 'start_ack':
              startCapture();
              break;
            case 'result_changed':
              // 实时中间结果：展示 已确认文本 + 当前中间结果
              currentInterimRef.current = content || '';
              onChangeRef.current?.(confirmedTextRef.current + currentInterimRef.current);
              break;
            case 'sentence_end':
              // 一句话确认：累积到 confirmedText
              confirmedTextRef.current += (content || '');
              currentInterimRef.current = '';
              onChangeRef.current?.(confirmedTextRef.current);
              break;
            case 'completed':
              // 最终完成：如果 completed 有内容就追加，然后回写全部累积文本
              if (content) confirmedTextRef.current += content;
              onCompletedRef.current?.(confirmedTextRef.current);
              confirmedTextRef.current = ''; // 清空防止 closeAll 重复回调
              closeAll();
              break;
            case 'failed':
              onErrorRef.current?.('语音识别服务返回错误');
              closeAll();
              break;
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!isStoppedRef.current) closeAll();
      };
    } catch (err) {
      onErrorRef.current?.(err.message || 'ASR 启动失败');
      closeAll();
    }
  }, [isRunning, isLoading, onChange, onCompleted, onError, closeAll, startCapture]);

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
      if (wsRef.current) { try { wsRef.current.close(); } catch {} }
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, []);

  return { start, stop, isRunning, isLoading };
}
