import express from "express";
import fetch from "node-fetch";
import Stripe from "stripe";
import bodyParser from "body-parser";
import crypto from "crypto";

const app = express();
const port = process.env.PORT || 8080;

// ----------------- Stripe -----------------
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ----------------- Meta Pixel -----------------
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

// ----------------- Shopify -----------------
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ----------------- Middleware -----------------
app.use("/webhook", bodyParser.raw({ type: "application/json" })); // Stripe precisa raw body
app.use(express.json());

// ----------------- Webhook Stripe -----------------
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
  const amount = session.amount_total / 100;
  const currency = session.currency;

  // Recuperar itens salvos no metadata
  let items = [];
  if (session.metadata?.cart) {
    try {
      items = JSON.parse(session.metadata.cart);
    } catch (e) {
      console.error("Erro ao parsear metadata.cart:", e);
    }
  }

  // Criar pedido na Shopify
  const shopifyOrder = {
    order: {
      email: session.customer_email || "noemail@example.com",
      financial_status: "paid",
      currency: currency.toUpperCase(),
      line_items: items.map((item) => ({
        title: item.name,
        quantity: item.quantity,
        price: (item.price / 100).toFixed(2), // Stripe envia em centavos
        taxable: false,
      })),
      shipping_address: session.customer_details?.address
        ? {
            first_name: session.customer_details.name?.split(" ")[0] || "",
            last_name: session.customer_details.name?.split(" ")[1] || "",
            address1: session.customer_details.address.line1,
            city: session.customer_details.address.city,
            country: session.customer_details.address.country,
            zip: session.customer_details.address.postal_code,
          }
        : undefined,
    },
  };

  try {
    const response = await fetch(
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

    const data = await response.json();
    if (!response.ok) {
      console.error("❌ Erro ao criar pedido na Shopify:", data);
    } else {
      console.log("✅ Pedido criado na Shopify:", data);
    }
  } catch (err) {
    console.error("❌ Erro ao enviar pedido para Shopify:", err);
  }

  // Enviar evento Purchase para Meta
  await sendMetaEvent("Purchase", amount, currency, session.customer_email);
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
async function sendMetaEvent(eventName, value, currency, email) {
  try {
    const hashedEmail =
      email && email.includes("@")
        ? crypto.createHash("sha256").update(email).digest("hex")
        : null;

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_source_url: "https://aveneli.com",
          action_source: "website",
          user_data: hashedEmail ? { em: [hashedEmail] } : {},
          custom_data: {
            currency,
            value,
          },
        },
      ],
      access_token: META_ACCESS_TOKEN,
    };

    const response = await fetch(
      `https://graph.facebook.com/v20.0/${META_PIXEL_ID}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    console.log(`✅ Evento Meta enviado: ${eventName}`, data);
  } catch (err) {
    console.error(`❌ Erro enviando evento Meta ${eventName}:`, err);
  }
}

// ----------------- Endpoint Checkout -----------------
app.post("/checkout", async (req, res) => {
  const { items, email } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Itens do carrinho são obrigatórios" });
  }

  try {
    const stripeItems = items.map((item) => ({
      price_data: {
        currency: "eur",
        product_data: {
          name: item.name,
          images: item.image ? [item.image] : [],
        },
        unit_amount: item.price, // em centavos
      },
      quantity: item.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "klarna", "ideal"],
      mode: "payment",
      line_items: stripeItems,
      metadata: { cart: JSON.stringify(items) }, // salva carrinho no checkout
      ...(email ? { customer_email: email } : {}),
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["NL", "BE", "DE", "FR", "IT", "ES", "PT", "FI", "AT", "IE"],
      },
      success_url: "https://aveneli.com/pages/sucesso",
      cancel_url: "https://aveneli.com/pages/cancelado",
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    console.error("❌ Erro ao criar checkout:", err.message);
    res.status(500).json({ error: "Erro ao criar checkout" });
  }
});

// ----------------- Start server -----------------
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});


// ----------------- Start server -----------------
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});
