import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import Stripe from "stripe";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Middlewares ---
// Webhook Stripe precisa do raw body
app.use(
  "/webhook",
  bodyParser.raw({ type: "application/json" })
);

// Para outras rotas com JSON normal
app.use(express.json());

// --- Webhook Stripe ---
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

  console.log("✅ Webhook recebido:", event.type);

  // Enviar evento para a Meta
  try {
    const metaResponse = await fetch(
      `https://graph.facebook.com/v16.0/${process.env.META_PIXEL_ID}/events?access_token=${process.env.META_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [
            {
              event_name: "Purchase",
              event_time: Math.floor(Date.now() / 1000),
              action_source: "website",
              event_id: event.id,
              custom_data: {
                value: event.data.object.amount / 100,
                currency: event.data.object.currency
              }
            }
          ]
        }),
      }
    );

    const metaData = await metaResponse.json();
    console.log("✅ Evento enviado para a Meta:", metaData);
  } catch (err) {
    console.error("❌ Erro ao enviar evento para a Meta:", err);
  }

  res.json({ received: true });
});

// --- Criar pedido na Shopify ---
app.post("/create-order", async (req, res) => {
  const shopifyOrder = req.body;

  try {
    const shopifyResponse = await fetch(
      `https://${process.env.SHOPIFY_DOMAIN}/admin/api/2025-01/orders.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
        },
        body: JSON.stringify(shopifyOrder),
      }
    );

    const shopifyData = await shopifyResponse.json();
    console.log("🛍️ Pedido criado na Shopify:", shopifyData);
    res.json(shopifyData);
  } catch (err) {
    console.error("❌ Erro ao criar pedido na Shopify:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Rota de teste ---
app.get("/", (req, res) => {
  res.send("Servidor rodando! 🚀");
});

// --- Iniciar servidor na porta Fly.io ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

