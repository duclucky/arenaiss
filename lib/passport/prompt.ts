import { z } from 'zod';

// System prompt for Card Passport AI narration. Keep in sync with prompts/passport-narration.md.
export const PASSPORT_SYSTEM_PROMPT = `You are "Card Passport", a transparent collector assistant for Renaiss
(RWA collectibles: graded cards on BNB Chain). The UI already shows the raw
reference estimate, custody chips, and on-chain activity table. Your task is to add
a short collector insight that helps a player understand the card without repeating
those raw fields.

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
Write 2-4 short sentences, maximum 120 words. Do not use section labels such as
"Summary:", "Provenance:", "Custody:", or "Reference price:". Do not repeat the
full price, vault location, tx list, or source table already shown by the UI. You may
mention confidence or thin data in plain language when it affects interpretation.
End with a compact caveat that this is experimental reference data, not verified
market truth or financial advice. If the data is too sparse to say something
meaningful, say that directly instead of filling space with speculation.`;

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
  const gradeStr = [card.gradingCompany, card.grade].filter(Boolean).join(' ');
  const identity = `**${card.name}**${card.setName ? ` from ${card.setName}` : ''}${gradeStr ? `, graded ${gradeStr}` : ''}${card.year ? `, released in ${card.year}` : ''}`;
  const acts = onchain.activities ?? [];
  const history = acts.length > 0
    ? `It has ${acts.length} recorded on-chain event${acts.length === 1 ? '' : 's'}, so there is a visible custody trail rather than just a static catalog entry.`
    : 'The current dataset does not include on-chain activity for this card, so the visible trail is sparse.';
  const custodyHint = custody.vaultLocation || custody.countryCode
    ? 'The vault metadata gives enough context to understand this as a custodied physical collectible represented on-chain.'
    : 'Custody metadata is incomplete, so treat the physical-location context as unavailable.';
  const confidence = reference?.confidence ?? null;
  const thin = reference?.observationCount != null && reference.observationCount < 10;
  const referenceHint = reference?.priceUsd != null
    ? `The index match exists as of ${asOfShort}${confidence ? ` with ${confidence} confidence` : ''}${thin ? ', but the sample is thin' : ''}.`
    : 'No matched index estimate is available, so the Passport should be read mostly from identity, custody, and activity data.';

  return [
    `${identity}. ${history}`,
    `${custodyHint} ${referenceHint}`,
    '_Experimental reference data only; not verified market truth or financial advice._',
  ].join('\n\n');
}
