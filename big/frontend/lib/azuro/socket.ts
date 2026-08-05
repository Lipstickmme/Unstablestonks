// Live odds over WebSocket.
//
// Prices move on every ball, and a book that only polls will take bets at stale odds and
// then have the relayer reject them. This client keeps one socket per chain, tracks what
// each caller subscribed to, and re-subscribes after a reconnect so a dropped connection
// is invisible to the UI.

import { getChainData } from "./config";
import type { ConditionData, GameData } from "./types";

type FeedEvent =
  | { event: "ConditionUpdated"; data: ConditionData }
  | { event: "GameUpdated"; data: GameData }
  | { event: string; data: unknown };

export type ConditionListener = (condition: ConditionData) => void;
export type GameListener = (game: GameData) => void;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

class AzuroSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByCaller = false;

  private readonly conditionListeners = new Map<string, Set<ConditionListener>>();
  private readonly gameListeners = new Map<string, Set<GameListener>>();

  constructor(
    private readonly url: string,
    private readonly environment: string,
  ) {}

  private get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(event: string, data: Record<string, unknown>) {
    if (this.isOpen) {
      this.ws?.send(JSON.stringify({ event, data: { ...data, environment: this.environment } }));
    }
  }

  private connect() {
    if (this.ws || typeof WebSocket === "undefined") {
      return;
    }

    this.closedByCaller = false;
    const socket = new WebSocket(`${this.url}/feed`);
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.resubscribeAll();
    };

    socket.onmessage = (message) => {
      let payload: FeedEvent;

      try {
        payload = JSON.parse(message.data as string) as FeedEvent;
      } catch {
        return;
      }

      if (payload.event === "ConditionUpdated") {
        const condition = payload.data as ConditionData;
        this.conditionListeners
          .get(condition.conditionId)
          ?.forEach((listener) => listener(condition));
        return;
      }

      if (payload.event === "GameUpdated") {
        const game = payload.data as GameData;
        this.gameListeners.get(game.gameId)?.forEach((listener) => listener(game));
      }
    };

    socket.onclose = () => {
      this.ws = null;

      if (!this.closedByCaller && this.hasSubscriptions()) {
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private hasSubscriptions() {
    return this.conditionListeners.size > 0 || this.gameListeners.size > 0;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private resubscribeAll() {
    const conditionIds = [...this.conditionListeners.keys()];
    const gameIds = [...this.gameListeners.keys()];

    if (conditionIds.length) {
      this.send("SubscribeConditions", { conditionIds });
    }

    if (gameIds.length) {
      this.send("SubscribeGames", { gameIds });
    }
  }

  subscribeConditions(conditionIds: string[], listener: ConditionListener): () => void {
    const fresh = conditionIds.filter((id) => !this.conditionListeners.has(id));

    conditionIds.forEach((id) => {
      const listeners = this.conditionListeners.get(id) ?? new Set<ConditionListener>();
      listeners.add(listener);
      this.conditionListeners.set(id, listeners);
    });

    this.connect();

    if (fresh.length) {
      this.send("SubscribeConditions", { conditionIds: fresh });
    }

    return () => {
      const dropped: string[] = [];

      conditionIds.forEach((id) => {
        const listeners = this.conditionListeners.get(id);
        listeners?.delete(listener);

        if (listeners && listeners.size === 0) {
          this.conditionListeners.delete(id);
          dropped.push(id);
        }
      });

      if (dropped.length) {
        this.send("UnsubscribeConditions", { conditionIds: dropped });
      }

      this.closeIfIdle();
    };
  }

  subscribeGames(gameIds: string[], listener: GameListener): () => void {
    const fresh = gameIds.filter((id) => !this.gameListeners.has(id));

    gameIds.forEach((id) => {
      const listeners = this.gameListeners.get(id) ?? new Set<GameListener>();
      listeners.add(listener);
      this.gameListeners.set(id, listeners);
    });

    this.connect();

    if (fresh.length) {
      this.send("SubscribeGames", { gameIds: fresh });
    }

    return () => {
      const dropped: string[] = [];

      gameIds.forEach((id) => {
        const listeners = this.gameListeners.get(id);
        listeners?.delete(listener);

        if (listeners && listeners.size === 0) {
          this.gameListeners.delete(id);
          dropped.push(id);
        }
      });

      if (dropped.length) {
        this.send("UnsubscribeGames", { gameIds: dropped });
      }

      this.closeIfIdle();
    };
  }

  private closeIfIdle() {
    if (this.hasSubscriptions()) {
      return;
    }

    this.closedByCaller = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.ws?.close();
    this.ws = null;
  }
}

const sockets = new Map<number, AzuroSocket>();

/** One socket per chain, shared by every component that asks for it. */
export const getAzuroSocket = (chainId: number): AzuroSocket => {
  const existing = sockets.get(chainId);

  if (existing) {
    return existing;
  }

  const { socket, environment } = getChainData(chainId);
  const created = new AzuroSocket(socket, environment);
  sockets.set(chainId, created);

  return created;
};

export type { AzuroSocket };
