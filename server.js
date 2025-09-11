import express from "express";
import fetch from "node-fetch";
import Stripe from "stripe";
import bodyParser from "body-parser";

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

// ----------------- Webhook Stripe -----------------
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }), // precisa ser raw só aqui
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body, // buffer cru
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
        default:
          console.log("Evento não tratado:", type);
      }
    } catch (err) {
      console.error("Erro ao processar evento:", err);
    }

    res.status(200).send({ received: true });
  }
);

// ----------------- Middleware JSON para o resto -----------------
app.use(express.json());

// ----------------- Funções -----------------
async function handleCheckoutCompleted(session) {
  try {
    // Buscar os line_items reais da sessão Stripe
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      expand: ["data.price.product"],
    });

    // Montar line_items no formato da Shopify
    const shopifyLineItems = lineItems.data.map((item) => ({
      title: item.description,
      quantity: item.quantity,
      price: (item.amount_total / 100).toFixed(2),
      taxable: false,
    }));

    const amount = session.amount_total / 100;
    const currency = session.currency.toUpperCase();

    // Criar pedido na Shopify
    const shopifyOrder = {
      order: {
        email: session.customer_details?.email || "noemail@example.com",
        line_items: shopifyLineItems,
        financial_status: "paid",
        currency: currency,
      },
    };

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

    if (!shopifyResponse.ok) {
      console.error("❌ Erro da Shopify:", shopifyData);
    } else {
      console.log("🛍️ Pedido criado na Shopify:", shopifyData);
    }

    // Enviar evento Purchase para Meta
    await sendMetaEvent("Purchase", amount, currency);
  } catch (err) {
    console.error("Erro ao criar pedido na Shopify:", err);
  }
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
    console.error(`❌ Erro enviando evento Meta ${eventName}:`, err);
  }
}

// ----------------- Start server -----------------
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});
