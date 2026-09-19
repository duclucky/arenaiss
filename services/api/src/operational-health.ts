export type OperationalHealthState = 'STARTING' | 'HEALTHY' | 'DEGRADED';

type Component = { intervalMs: number; registeredAt: number; lastSuccessAt?: number; lastFailureAt?: number };

export class OperationalHealthRegistry {
  private readonly components = new Map<string, Component>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  register(name: string, intervalMs: number): void {
    if (!name || !Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new TypeError('health component configuration is invalid');
    this.components.set(name, { intervalMs, registeredAt: this.now() });
  }

  success(name: string): void { this.require(name).lastSuccessAt = this.now(); }
  failure(name: string): void { this.require(name).lastFailureAt = this.now(); }

  readiness(): { ready: boolean; components: Record<string, OperationalHealthState> } {
    const at = this.now();
    const components: Record<string, OperationalHealthState> = {};
    let ready = true;
    for (const [name, component] of this.components) {
      const graceEndsAt = component.registeredAt + component.intervalMs * 2;
      const staleAfter = component.intervalMs * 3 + 5_000;
      const failed = component.lastFailureAt !== undefined && (component.lastSuccessAt === undefined || component.lastFailureAt >= component.lastSuccessAt);
      const stale = component.lastSuccessAt !== undefined && at - component.lastSuccessAt > staleAfter;
      const missedStartup = component.lastSuccessAt === undefined && at > graceEndsAt;
      const state: OperationalHealthState = failed || stale || missedStartup ? 'DEGRADED' : component.lastSuccessAt === undefined ? 'STARTING' : 'HEALTHY';
      components[name] = state;
      if (state === 'DEGRADED') ready = false;
    }
    return { ready, components };
  }

  private require(name: string): Component {
    const component = this.components.get(name);
    if (!component) throw new Error(`health component is not registered: ${name}`);
    return component;
  }
}
