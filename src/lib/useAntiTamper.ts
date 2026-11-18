'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SECURITY_POLICY } from './securityClient';

function isTouchOrMobileEnvironment(): boolean {
  if (typeof window === 'undefined') return true;
  const ua = navigator.userAgent || '';
  const isMobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  return isMobileUa || hasTouch || window.innerWidth < 1024;
}

function isMobileViewportOrUa(): boolean {
  if (typeof window === 'undefined') return true;
  const ua = navigator.userAgent || '';
  const isMobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  return isMobileUa || window.innerWidth < 1024;
}

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

    // Never run dimension or console DevTools heuristics on mobile/tablet/touch browsers
    if (isMobileViewportOrUa()) {
      return false;
    }

    // Dimension-based check ONLY runs on non-touch desktop screens >= 1024px
    if (!isTouchOrMobileEnvironment() && window.outerWidth > 0 && window.outerHeight > 0) {
      const widthDelta = window.outerWidth - window.innerWidth;
      const heightDelta = window.outerHeight - window.innerHeight;

      if (widthDelta > SECURITY_POLICY.devtoolsDeltaPx) {
        reportTamper(`dimension_delta_w:${widthDelta}`);
        return true;
      }

      if (heightDelta > SECURITY_POLICY.devtoolsDeltaPx) {
        reportTamper(`dimension_delta_h:${heightDelta}`);
        return true;
      }
    }

    // Desktop-only console getter probe (window.innerWidth >= 1024 and non-mobile UA)
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
    if (SECURITY_POLICY.isDev || isMobileViewportOrUa()) {
      setTamperDetected(false);
      setTamperReason(null);
      return;
    }

    const initialTimer = setTimeout(() => {
      checkSignals();
    }, 600);

    const interval = setInterval(() => {
      const triggered = checkSignals();
      if (!triggered && tamperDetected) {
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
