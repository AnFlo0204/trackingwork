'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SECURITY_POLICY } from './securityClient';

export function useAntiTamper() {
  const [tamperDetected, setTamperDetected] = useState(false);
  const [tamperReason, setTamperReason] = useState<string | null>(null);
  const reportedRef = useRef(false);

  const reportTamper = useCallback((signal: string) => {
    setTamperDetected(true);
    setTamperReason(signal);

    if (reportedRef.current) return;
    reportedRef.current = true;

    try {
      void fetch('/api/security/tamper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal }),
        keepalive: true,
      });
    } catch {
      // ignore network failures during lockout
    }
  }, []);

  const checkSignals = useCallback(() => {
    if (typeof window === 'undefined' || SECURITY_POLICY.isDev) return false;

    const activeTag = document.activeElement?.tagName || '';
    const isEditingField =
      activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
    const isNarrowMobile = window.innerWidth < 768;

    if (window.outerWidth > 0 && window.outerHeight > 0) {
      const widthDelta = window.outerWidth - window.innerWidth;
      const heightDelta = window.outerHeight - window.innerHeight;

      if (widthDelta > SECURITY_POLICY.devtoolsDeltaPx) {
        reportTamper(`dimension_delta_w:${widthDelta}`);
        return true;
      }

      if (heightDelta > SECURITY_POLICY.devtoolsDeltaPx && !(isNarrowMobile && isEditingField)) {
        reportTamper(`dimension_delta_h:${heightDelta}`);
        return true;
      }
    }

    // Console object getter trap
    let consoleOpened = false;
    const probe = new Image();
    try {
      Object.defineProperty(probe, 'id', {
        get() {
          consoleOpened = true;
          return 'tw_probe';
        },
      });
      // eslint-disable-next-line no-console
      console.debug('%c', probe);
    } catch {
      // ignore
    }

    if (consoleOpened) {
      reportTamper('console_getter_anomaly');
      return true;
    }

    return false;
  }, [reportTamper]);

  useEffect(() => {
    if (SECURITY_POLICY.isDev) return;

    const initialTimer = setTimeout(() => {
      checkSignals();
    }, 600);

    const interval = setInterval(() => {
      const triggered = checkSignals();
      if (!triggered && tamperDetected) {
        // Auto-recover only if dimensions and signals returned cleanly
        setTamperDetected(false);
        setTamperReason(null);
      }
    }, 2000);

    function onResize() {
      const triggered = checkSignals();
      if (!triggered && tamperDetected) {
        setTamperDetected(false);
        setTamperReason(null);
      }
    }

    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      window.removeEventListener('resize', onResize);
    };
  }, [checkSignals, tamperDetected]);

  return {
    tamperDetected,
    tamperReason,
    triggerTamperSignal: reportTamper,
    recheckNow: () => {
      if (!checkSignals()) {
        setTamperDetected(false);
        setTamperReason(null);
      }
    },
  };
}
