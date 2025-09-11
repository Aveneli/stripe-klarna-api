import express from "express";
import fetch from "node-fetch";
import Stripe from "stripe";
import bodyParser from "body-parser";

const app = express();
const port = process.env.PORT || 8080; // Porta segura para Fly.io

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Meta Pixel
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_ACCSESS_TOKEN;

// Shopify
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Para receber o raw body necessário para validar o webhook do Stripe
app.use(
  "/webhook",
  bodyParser.raw({ type: "application/json" })
);

app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Erro no webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const { type, data } = event;

  try {
    switch (type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(data.object);
        break;
      case "payment_intent.succeeded":
        await handlePaymentSucceeded(data.object);
        break;
      case "payment_intent.created":
        await handlePaymentCreated(data.object);
        break;
      default:
        console.log("Evento não tratado:", type);
    }
  } catch (err) {
    console.error("Erro ao processar evento:", err);
  }

  res.status(200).send();
});

// ----------------- Funções -----------------

async function handleCheckoutCompleted(session) {
  const amount = session.amount_total / 100; // Stripe envia em centavos
  const currency = session.currency;

  // Criar pedido na Shopify
  const shopifyOrder = {
    order: {
      email: session.customer_email || "noemail@example.com",
      line_items: [
        {
          title: "Pedido via Stripe",
          quantity: 1,
          price: amount.toFixed(2),
        },
      ],
      financial_status: "paid",
      currency,
    },
  };

  try {
    const shopifyResponse = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/orders.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        },
        body: JSON.stringify(shopifyOrder),
      }
    );
    const shopifyData = await shopifyResponse.json();
    console.log("🛍️ Pedido criado na Shopify:", shopifyData);
  } catch (err) {
    console.error("Erro ao criar pedido na Shopify:", err);
  }

  // Enviar evento Purchase para Meta
  await sendMetaEvent("Purchase", amount, currency);
}

async function handlePaymentCreated(intent) {
  const amount = intent.amount / 100;
  const currency = intent.currency;
  await sendMetaEvent("InitiateCheckout", amount, currency);
}

async function handlePaymentSucceeded(intent) {
  const amount = intent.amount / 100;
  const currency = intent.currency;
  await sendMetaEvent("AddPaymentInfo", amount, currency);
}

// ----------------- Meta Pixel -----------------
async function sendMetaEvent(eventName, value, currency) {
  try {
    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_source_url: "https://yourshopifystore.com",
          action_source: "website",
          custom_data: {
            currency,
            value,
          },
        },
      ],
      access_token: META_ACCESS_TOKEN,
    };

    const response = await fetch(
      `https://graph.facebook.com/v17.0/${META_PIXEL_ID}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    console.log(`✅ Evento Meta enviado: ${eventName}`, data);
  } catch (err) {
    console.error(`Erro enviando evento Meta ${eventName}:`, err);
  }
}

// ----------------- Start server -----------------
const port = process.env.PORT || 8080; // Fly.io define PORT automaticamente
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});
