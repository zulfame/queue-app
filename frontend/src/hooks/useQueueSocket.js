import { useEffect, useRef, useState } from "react";
import { BACKEND_URL } from "../lib/api";

export function useQueueSocket(onEvent) {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let ws;
    let alive = true;
    let retry;

    const connect = () => {
      const url = BACKEND_URL.replace(/^http/, "ws") + "/api/ws";
      ws = new WebSocket(url);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        try {
          handlerRef.current(JSON.parse(e.data));
        } catch {}
      };
      ws.onclose = () => {
        setConnected(false);
        if (alive) retry = setTimeout(connect, 2500);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => {
      alive = false;
      clearTimeout(retry);
      if (ws) ws.close();
    };
  }, []);

  return connected;
}
