import { z } from 'zod';

// System prompt for Card Passport AI narration. Keep in sync with prompts/passport-narration.md.
export const PASSPORT_SYSTEM_PROMPT = `You are "Card Passport", a transparent collector assistant for Renaiss
(RWA collectibles: graded cards on BNB Chain). Your task is to read the real data
for ONE card and explain, in plain collector language, what the card is, what its
on-chain history shows, how it is custodied, and how reliable the reference price is.

INVARIANT RULES:
1. Use ONLY the data supplied in the message. Never invent numbers or infer missing
   data. If a field is null or missing, say that no data is available for that point.
2. Every numeric claim must include source and time. Reference prices must say
   "according to Renaiss OS Index, as of <asOf>". On-chain data should include
   txHash/time when relevant.
3. Respect confidence. If confidence is "low" or observationCount is small, do not
   present the number as certain. Say that the data is thin/experimental and should
   be treated cautiously. If methods diverge, explain that as possible volatility or
   thin liquidity.
4. Never conclude that a card is fake, fraudulent, or wash-traded. You may mention
   "signals worth checking" only when tied to concrete evidence such as txHash and
   timestamp, with uncertainty.
5. Do not give financial or investment advice, future price predictions, or buy/sell
   pressure. You may describe historical facts in the provided data.
6. This is beta data and may be incomplete, delayed, or updating. End with a short
   caveat that this is experimental reference data, not verified market truth.

VOICE: clear, friendly, concise, and grounded. Avoid hype and marketing language.

OUTPUT FORMAT:
- Summary: 1-2 sentences explaining what the card is.
- Provenance: brief on-chain journey with timestamps/txHashes when present. If there
  are signals worth checking, frame them as signals, not conclusions.
- Custody: where/how it is held and what that means for a collector.
- Reference price: price range/value, confidence, source, and time; mention thin data
  or divergent methods when applicable.
- Final caveat: beta reference, not verified market truth, not financial advice.
If the data is too sparse to say something meaningful, say that directly instead of
filling space with speculation.`;

// Input contract matching prompts/passport-narration.md; route validates with Zod.
export const PassportInputSchema = z.object({
  card: z.object({
    name: z.string(),
    setName: z.string().nullable(),
    grade: z.string().nullable(),
    gradingCompany: z.string().nullable(),
    year: z.number().nullable(),
    tokenId: z.string(),
  }),
  custody: z.object({
    vaultLocation: z.string().nullable(),
    countryCode: z.string().nullable(),
  }),
  onchain: z.object({
    activities: z.array(
      z.object({
        type: z.string(),
        timestamp: z.string().nullable(),
        txHash: z.string().nullable(),
        amount: z.union([z.string(), z.number()]).nullable(),
      }),
    ),
    lastSale: z.union([z.string(), z.number()]).nullable(),
  }),
  reference: z.object({
    source: z.string(),
    priceUsd: z.number().nullable(),
    confidence: z.string().nullable(),
    observationCount: z.number().nullable(),
    lastSaleAt: z.string().nullable(),
    deltas: z.object({ d7: z.number().nullable(), d30: z.number().nullable(), d365: z.number().nullable() }).nullable(),
    sourceBreakdown: z.array(z.object({ bucket: z.string().nullable(), medianUsd: z.number().nullable() })),
  }).nullable(),
  asOf: z.string(),
});
export type PassportInput = z.infer<typeof PassportInputSchema>;

// Deterministic fallback used when no LLM key is configured.
export function fallbackNarration(input: PassportInput): string {
  const { card, custody, onchain, reference, asOf } = input;
  const asOfShort = asOf.slice(0, 10);
  const lines: string[] = [];

  const gradeStr = [card.gradingCompany, card.grade].filter(Boolean).join(' ');
  lines.push(
    `**${card.name}**${card.setName ? ` from ${card.setName}` : ''}${gradeStr ? `, graded ${gradeStr}` : ''}${card.year ? `, released in ${card.year}` : ''}.`,
  );

  // Provenance
  const acts = onchain.activities ?? [];
  if (acts.length > 0) {
    const last = acts[0];
    const when = last.timestamp ? new Date(Number(last.timestamp) * 1000).toISOString().slice(0, 10) : 'unknown date';
    lines.push(
      `**Provenance:** ${acts.length} on-chain activities are recorded; the latest is "${last.type}" (${when}${last.txHash ? `, tx ${last.txHash.slice(0, 10)}...` : ''}). This is historical data only, with no extra inference.`,
    );
  } else {
    lines.push('**Provenance:** no on-chain activity data is available for this card.');
  }

  // Custody
  if (custody.vaultLocation || custody.countryCode) {
    lines.push(
      `**Custody:** ${custody.vaultLocation ? `vault type "${custody.vaultLocation}"` : 'vault type is unknown'}${custody.countryCode ? `, located in ${custody.countryCode}` : ''}. The physical card is held in custody; the on-chain record represents the vaulted item.`,
    );
  } else {
    lines.push('**Custody:** no custody data is available for this card.');
  }

  // Reference price
  if (reference && reference.priceUsd != null) {
    const conf = reference.confidence ?? 'unknown';
    const thin = reference.observationCount != null && reference.observationCount < 10;
    lines.push(
      `**Reference price:** ~$${reference.priceUsd.toLocaleString('en-US')} according to ${reference.source}, confidence ${conf}${reference.observationCount != null ? `, based on ${reference.observationCount} observations` : ''} (as of ${asOfShort}).` +
        (thin ? ' The observation count is thin, so treat this as experimental reference data.' : ''),
    );
  } else {
    lines.push('**Reference price:** no Renaiss OS Index price data is available for this card, or it could not be matched.');
  }

  lines.push(
    '_This is beta data: experimental reference, not verified market truth, and not financial advice._',
  );
  return lines.join('\n\n');
}
