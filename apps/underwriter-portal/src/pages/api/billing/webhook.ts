import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

const prisma = new PrismaClient();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// ────────────────────────────────────────────────────────────────────────
// 1. STRIPE METADATA SCHEMA FOR AUTOMATED TRANSACTION CHECKS
// ────────────────────────────────────────────────────────────────────────
export interface StripeProcessingMetadata {
  loanId: string;
  tenantId: string;
  targetTier: 'W2_WAGE_EARNER' | 'SOLE_PROPRIETOR_SINGLE_ENTITY' | 'MULTI_ENTITY_PORTFOLIO_OR_USDA';
  isUpgrade: 'true' | 'false';
  historicalTier?: 'W2_WAGE_EARNER' | 'SOLE_PROPRIETOR_SINGLE_ENTITY' | 'MULTI_ENTITY_PORTFOLIO_OR_USDA';
  calculatedCents: string; // Dynamic amount calculated in cents
}

/**
 * PRODUCTION-GRADE STRIPE WEBHOOK HANDLER
 * Handles: payment_intent.succeeded
 * Processes: $8.00 / $25.00 / $45.00 volumetric billing, upgrades ($17/$37/$20 deltas), and $0.00 resubmissions
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  let event: Stripe.Event;

  // 1. Cryptographic Signature Verification
  try {
    if (!sig || !endpointSecret) {
      return NextResponse.json({ error: 'Missing security credentials' }, { status: 400 });
    }
    event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
  } catch (err: any) {
    console.error(`❌ Webhook Signature Verification Failed: ${err.message}`);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  // 2. Handle Payment Intent Success Event
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const metadata = paymentIntent.metadata as unknown as StripeProcessingMetadata;

    // Validate essential metadata presence to prevent orphan charges
    if (!metadata.loanId || !metadata.targetTier) {
      console.warn(`⚠️ Received PaymentIntent ${paymentIntent.id} without required FreeFlow metadata properties.`);
      return NextResponse.json({ received: true, warning: 'Missing application context' });
    }

    const { loanId, targetTier, isUpgrade, calculatedCents } = metadata;

    console.log(`💳 Stripe Charge Success! Processing Transaction for Loan: ${loanId} | Tier: ${targetTier} | Cents: ${calculatedCents}`);

    try {
      // 3. Perform Fail-Secure Database State Transition in a Single Transaction
      await prisma.$transaction(async (tx) => {
        // Fetch current loan application record to verify state
        const loan = await tx.loanApplication.findUnique({
          where: { id: loanId },
        });

        if (!loan) {
          throw new Error(`Loan record ${loanId} not found during Stripe success sync`);
        }

        // Commit billing ledger update
        await tx.tenantBillingLedger.create({
          data: {
            tenantId: metadata.tenantId,
            loanId: loanId,
            amountCents: Number(calculatedCents) || paymentIntent.amount,
            stripeChargeId: paymentIntent.id,
            isBilled: true,
            activeTier: targetTier === 'W2_WAGE_EARNER' ? 'STANDARD' : 'COMPLEX',
            documentHashList: [],
          },
        });

        console.log(`✅ Database Synchronized for Loan: ${loanId}. Billed Tier set to: ${targetTier}.`);
      });

      return NextResponse.json({ 
        success: true, 
        loanId, 
        billedTier: targetTier, 
        centsCharged: Number(calculatedCents) 
      });

    } catch (dbErr: any) {
      console.error(`❌ Database Commit Failed after successful Stripe charge: ${dbErr.message}`);
      // Return 500 so Stripe retries the webhook delivery (Critical to maintain billing integrity)
      return NextResponse.json({ error: 'Database transaction lock failure' }, { status: 500 });
    }
  }

  // Return 200 for unhandled events to acknowledge receipt
  return NextResponse.json({ received: true });
}
