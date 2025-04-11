import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.config";
import prisma from "@/lib/db/prisma";
import {
  getFiatTransactionByServicePaymentId,
  setFiatTransactionStatusToFailed,
  setFiatTransactionStatusToSucceeded,
} from "@/lib/db/services/fiatTransaction.service";
import {
  FiatTransaction,
  FiatTransactionStatus,
} from "@/prisma/generated/client";

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);

export async function POST(req: Request) {
  let event: Stripe.Event;

  try {
    const stripeSignature = req.headers.get("stripe-signature");

    event = stripe.webhooks.constructEvent(
      await req.text(),
      stripeSignature as string,
      getEnvSecrets().STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.log(`❌ Error message: ${message}`);
    return NextResponse.json(
      { message: `Webhook Error: ${message}` },
      { status: 400 },
    );
  }

  const permittedEvents: string[] = [
    "checkout.session.completed",
    "checkout.session.expired",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "customer.created",
  ];

  console.log(`🔍 Event id: ${event.id}`);

  if (permittedEvents.includes(event.type)) {
    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          handleCheckoutSessionCompletedEvent(session)
            .then((fiatTransaction) => {
              console.info(
                `💰 Fiat transaction status: ${fiatTransaction.status}`,
              );
            })
            .catch((error) => {
              console.error(error);
            });
          break;
        }
        case "checkout.session.async_payment_succeeded": {
          const session = event.data.object as Stripe.Checkout.Session;
          handleCheckoutSessionAsyncPaymentSucceededEvent(session)
            .then((fiatTransaction) => {
              console.info(
                `💰 Fiat transaction status: ${fiatTransaction.status}`,
              );
            })
            .catch((error) => {
              console.error(error);
            });
          break;
        }
        case "checkout.session.expired": {
          const session = event.data.object as Stripe.Checkout.Session;
          handleCheckoutSessionExpiredEvent(session)
            .then((fiatTransaction) => {
              console.info(
                `💰 Fiat transaction status: ${fiatTransaction.status}`,
              );
            })
            .catch((error) => {
              console.error(error);
            });
          break;
        }
        case "checkout.session.async_payment_failed": {
          const session = event.data.object as Stripe.Checkout.Session;
          handleCheckoutSessionAsyncPaymentFailedEvent(session)
            .then((fiatTransaction) => {
              console.info(
                `💰 Fiat transaction status: ${fiatTransaction.status}`,
              );
            })
            .catch((error) => {
              console.error(error);
            });
          break;
        }
        case "customer.created": {
          const customer = event.data.object as Stripe.Customer;
          handleCustomerCreatedEvent(customer)
            .then((user) => {
              console.info(
                `💰 Customer ${customer.id} linked to user: ${user.id}`,
              );
            })
            .catch((error) => {
              console.error(error);
            });
          break;
        }
        default:
          throw new Error(`Unhandled event: ${event.type}`);
      }
    } catch (error) {
      console.error(error);
      return NextResponse.json(
        { message: "Webhook handler failed" },
        { status: 500 },
      );
    }
  }

  // Return a response to acknowledge receipt of the event.
  return NextResponse.json({ message: "Received" }, { status: 200 });
}

const handleCustomerCreatedEvent = async (customer: Stripe.Customer) => {
  const email = customer.email;
  if (!email) {
    throw new Error(`Customer email not found for customer: ${customer.id}`);
  }
  const user = await prisma.user.update({
    where: { email },
    data: { stripeCustomerId: customer.id },
  });
  if (!user) {
    throw new Error(`User not found for email: ${email}`);
  }
  return user;
};

const checkPaymentStatus = (session: Stripe.Checkout.Session) => {
  const paymentStatus = session.payment_status;
  if (paymentStatus !== "paid") {
    throw new Error("Payment status is not paid");
  }
};

const handleCheckoutSessionCompletedEvent = async (
  session: Stripe.Checkout.Session,
) => {
  checkPaymentStatus(session);
  return await updateFiatTransactionStatus(session, "SUCCEEDED");
};

const handleCheckoutSessionExpiredEvent = async (
  session: Stripe.Checkout.Session,
) => {
  return await updateFiatTransactionStatus(session, "FAILED");
};

const handleCheckoutSessionAsyncPaymentSucceededEvent = async (
  session: Stripe.Checkout.Session,
) => {
  checkPaymentStatus(session);
  return await updateFiatTransactionStatus(session, "SUCCEEDED");
};

const handleCheckoutSessionAsyncPaymentFailedEvent = async (
  session: Stripe.Checkout.Session,
) => {
  return await updateFiatTransactionStatus(session, "FAILED");
};

const updateFiatTransactionStatus = async (
  session: Stripe.Checkout.Session,
  status: "SUCCEEDED" | "FAILED",
): Promise<FiatTransaction> => {
  return await prisma.$transaction(async (tx) => {
    const fiatTransaction = await getFiatTransactionByServicePaymentId(
      session.id,
      tx,
    );
    if (!fiatTransaction) {
      throw new Error(`Fiat transaction for session ${session.id} not found`);
    }

    if (session.client_reference_id !== fiatTransaction.id) {
      throw new Error(
        `Session client reference id ${session.client_reference_id} does not match fiat transaction id ${fiatTransaction.id}`,
      );
    }

    if (fiatTransaction.status !== FiatTransactionStatus.PENDING) {
      throw new Error("Fiat transaction is not pending");
    }

    switch (status) {
      case "SUCCEEDED":
        return await setFiatTransactionStatusToSucceeded(fiatTransaction, tx);
      case "FAILED":
        return await setFiatTransactionStatusToFailed(fiatTransaction, tx);
    }
  });
};
