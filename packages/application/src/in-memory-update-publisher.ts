import type { GameId, SessionUpdate, SpectatorMode } from "@wfill/contracts";
import type { GameUpdateListener, GameUpdatePublisher } from "./ports.js";

const modeKey = (mode: SpectatorMode): string => mode.kind === "seat" ? `seat:${mode.seat}` : mode.kind;

interface Subscription {
  readonly gameId: GameId;
  readonly mode: SpectatorMode;
  readonly listener: GameUpdateListener;
}

export class InMemoryGameUpdatePublisher implements GameUpdatePublisher {
  private readonly subscriptions = new Set<Subscription>();

  publish(gameId: GameId, updates: readonly SessionUpdate[]): void {
    for (const subscription of this.subscriptions) {
      if (subscription.gameId !== gameId) continue;
      for (const update of updates) {
        if (modeKey(update.audience) === modeKey(subscription.mode)) subscription.listener(update);
      }
    }
  }

  subscribe(
    gameId: GameId,
    mode: SpectatorMode,
    listener: GameUpdateListener,
  ): () => void {
    const subscription = { gameId, mode, listener };
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
  }
}

