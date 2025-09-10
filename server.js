import express from "express";
import fetch from "node-fetch";
import Stripe from "stripe";
import bodyParser from "body-parser";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Para endpoints normais (não webhook)
app.use(express.json());

// Endpoint do webhook Stripe
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log("❌ Erro no webhook:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Processa eventos específicos, ex: checkout.session.completed
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Criar pedido na Shopify
      const shopifyOrder = {
        order: {
          email: session.customer_email,
          line_items: session.display_items.map((item) => ({
            variant_id: item.price.product, // ajuste conforme seu catálogo
            quantity: item.quantity,
          })),
          financial_status: "paid",
        },
      };

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
      } catch (err) {
        console.log("❌ Erro criando pedido Shopify:", err);
      }

      // Enviar evento para Meta (Conversions API)
      const metaEvent = {
        data: [
          {
            event_name: "Purchase",
            event_time: Math.floor(Date.now() / 1000),
            action_source: "website",
            event_id: session.id,
            user_data: {
              em: session.customer_email
                ? stripe.utils.hash(session.customer_email)
                : null,
            },
            custom_data: {
              currency: session.currency,
              value: session.amount_total / 100,
            },
          },
        ],
      };

      try {
        await fetch(
          `https://graph.facebook.com/v17.0/${process.env.META_PIXEL_ID}/events?access_token=${process.env.META_ACCESS_TOKEN}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(metaEvent),
          }
        );
        console.log("✅ Evento enviado para Meta");
      } catch (err) {
        console.log("❌ Erro enviando evento para Meta:", err);
      }
    }

    res.json({ received: true });
  }
);

// Endpoint de teste geral
app.get("/", (req, res) => {
  res.send("Servidor rodando ✅");
});

// Porta dinâmica para Fly.io
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});


