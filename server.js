import express from "express";
import fetch from "node-fetch";
import Stripe from "stripe";
import bodyParser from "body-parser";

const app = express();
const port = process.env.PORT || 8080;

// ----------------- CONFIGURAÇÃO -----------------
// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Meta Pixel
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN; // corrigido

// Shopify
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ----------------- MIDDLEWARE -----------------
// Webhook precisa do body cru
app.use("/webhook", bodyParser.raw({ type: "application/json" }));

// Outras rotas podem usar JSON normalmente
app.use(express.json());

// ----------------- WEBHOOK STRIPE -----------------
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

// ----------------- FUNÇÕES DE EVENTOS -----------------
async function handleCheckoutCompleted(session) {
  const amount = session.amount_total / 100;
  const currency = session.currency;

  // Buscar os itens comprados no checkout
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

  const shopifyOrder = {
    order: {
      email: session.customer_email || "noemail@example.com",
      line_items: lineItems.data.map((item) => ({
        title: item.description,
        quantity: item.quantity,
        price: (item.amount_total / 100).toFixed(2),
      })),
      financial_status: "paid",
      currency,
    },
  };

  try {
