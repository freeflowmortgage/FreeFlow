import type { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { isProtectedRuntime } from '../../../server/runtimeMode';

const prisma = new PrismaClient();
const MAX_WEBHOOK_BYTES = 1024 * 1024;

export const config = {
  api: {
    bodyParser: false,
  },
};

export interface StripeProcessingMetadata {
  loanId: string;
  tenantId: string;
  targetTier: 'W2_WAGE_EARNER' | 'SOLE_PROPRIETOR_SINGLE_ENTITY' | 'MULTI_ENTITY_PORTFOLIO_OR_USDA';
  isUpgrade: 'true' | 'false';
  historicalTier?: 'W2_WAGE_EARNER' | 'SOLE_PROPRIETOR_SINGLE_ENTITY' | 'MULTI_ENTITY_PORTFOLIO_OR_USDA';
  calculatedCents: string;
}

/**
 * Pages Router adapter for Stripe webhooks.
 *
 * The legacy metadata-driven billing transition is available only to local
 * development. Staging and production fail closed until P0-09 adds an
 * authoritative, idempotent event ledger and server-side price reconciliation.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported.' },
    });
  }

  if (isProtectedRuntime()) {
    res.setHeader('Retry-After', '3600');
    return res.status(503).json({
      error: {
        code: 'BILLING_RECONCILIATION_NOT_READY',
        message: 'Billing reconciliation is not enabled in this environment.',
      },
    });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signatureHeader = req.headers['stripe-signature'];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  if (!stripeSecretKey || !endpointSecret || !signature) {
    return res.status(400).json({
      error: { code: 'WEBHOOK_CONFIGURATION_INVALID', message: 'Webhook verification is unavailable.' },
    });
  }

  let event: Stripe.Event;
  try {
    const body = await readRawBody(req, MAX_WEBHOOK_BYTES);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' as Stripe.LatestApiVersion });
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return res.status(413).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Webhook payload exceeds the allowed size.' },
      });
    }
    console.warn('[billing-webhook] signature verification failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return res.status(400).json({
      error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed.' },
    });
  }

  if (event.type !== 'payment_intent.succeeded') {
    return res.status(200).json({ received: true });
  }

  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  const metadata = paymentIntent.metadata as unknown as StripeProcessingMetadata;
  if (!metadata.loanId || !metadata.tenantId || !metadata.targetTier) {
    return res.status(400).json({
      error: { code: 'APPLICATION_CONTEXT_MISSING', message: 'Required billing context is missing.' },
    });
  }

  const { loanId, targetTier, calculatedCents } = metadata;
  try {
    await prisma.$transaction(async (tx) => {
      const loan = await tx.loanApplication.findUnique({ where: { id: loanId } });
      if (!loan) throw new Error('LoanNotFound');

      await tx.tenantBillingLedger.create({
        data: {
          tenantId: metadata.tenantId,
          loanId,
          amountCents: Number(calculatedCents) || paymentIntent.amount,
          stripeChargeId: paymentIntent.id,
          isBilled: true,
          activeTier: targetTier === 'W2_WAGE_EARNER' ? 'STANDARD' : 'COMPLEX',
          documentHashList: [],
        },
      });
    });

    return res.status(200).json({
      success: true,
      loanId,
      billedTier: targetTier,
      centsCharged: Number(calculatedCents),
    });
  } catch (error) {
    console.error('[billing-webhook] local transaction failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return res.status(500).json({
      error: { code: 'BILLING_TRANSACTION_FAILED', message: 'Billing transaction could not be recorded.' },
    });
  }
}

class PayloadTooLargeError extends Error {
  constructor() {
    super('Webhook payload too large');
    this.name = 'PayloadTooLargeError';
  }
}

function readRawBody(req: NextApiRequest, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let rejected = false;

    req.on('data', (chunk: Buffer | string) => {
      if (rejected) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buffer.length;
      if (received > maxBytes) {
        rejected = true;
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}
