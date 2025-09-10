// server.js
import express from "express";
import Stripe from "stripe";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-06-30.basil",
});

// ⚡ Webhook precisa do body cru (sem JSON parse antes!)
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
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

    // 🔔 Evento de checkout concluído
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      console.log("✅ Checkout concluído:", session);

      // Criar pedido na Shopify
      createShopifyOrder(session);
    }

    res.json({ received: true });
  }
);

// 🔄 Função para criar pedido na Shopify
async function createShopifyOrder(session) {
  try {
    const shopifyOrder = {
      order: {
        email: session.customer_details.email,
        financial_status: "paid",
        line_items: [
          {
            title: "Pagamento Stripe",
            quantity: 1,
            price: session.amount_total / 100, // Stripe manda em centavos
          },
        ],
      },
    };

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
    console.error("❌ Erro ao criar pedido na Shopify:", err.message);
  }
}

// ✅ Teste simples de rota
app.get("/", (req, res) => {
  res.send("Servidor rodando ✅");
});

app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});
