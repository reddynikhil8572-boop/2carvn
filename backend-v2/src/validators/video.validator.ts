import { z } from 'zod';

/** Requirements §7 — video tracking. */

/**
 * A heartbeat.
 *
 * Note what is absent: any timestamp. The server records `occurred_at` and
 * measures elapsed time against its own clock — which is the only reason the
 * watch-time clamp in video.service.ts means anything. A client that could
 * state when its previous heartbeat happened could manufacture an arbitrary
 * budget.
 */
export const heartbeatSchema = z
  .object({
    type: z.enum(['PLAY', 'PAUSE', 'SEEK', 'ENDED', 'HEARTBEAT']).default('HEARTBEAT'),

    /// Where the playhead is now.
    positionSeconds: z.number().int().min(0).max(86_400),

    /// How much the client believes was watched since its last report. Treated
    /// as a claim, not a fact: the service clamps it to real elapsed time.
    watchedSecondsDelta: z.number().int().min(0).max(3_600).optional(),

    /// The client's reporting interval, used only to size the budget for the
    /// FIRST heartbeat, when there is no previous one to measure against.
    intervalSeconds: z.number().int().min(1).max(60).default(15),

    /// Advisory, for §7's speed and device breakdowns. Never used to gate
    /// anything.
    playbackRate: z.number().min(0.25).max(4).optional(),
    device: z.string().trim().max(120).optional(),
  })
  .strict();

export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
