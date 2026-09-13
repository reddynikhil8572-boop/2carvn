/**
 * Readiness, as distinct from liveness.
 *
 * They answer different questions and conflating them causes two opposite
 * failures:
 *
 * - **Liveness** — "is this process broken?" A failing liveness probe gets the
 *   container *killed*. If it also depended on the database, a brief database
 *   blip would restart every replica at once, turning a recoverable outage into
 *   a cold start under load.
 * - **Readiness** — "should traffic come here *right now*?" A failing readiness
 *   probe only removes the pod from the load balancer.
 *
 * So `/health` stays trivially true while the process is alive, and `/ready`
 * reflects whether this instance can actually serve — including saying **no**
 * during shutdown, before the drain begins, so the load balancer stops sending
 * work into a process that is closing.
 */

let ready = false;

export const setReady = (value: boolean): void => {
  ready = value;
};

export const isReady = (): boolean => ready;
