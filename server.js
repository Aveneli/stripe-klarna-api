const express = require("express");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const fetch = require("node-fetch"); // necessário para Shopify

// ================= MIDDLEWARES =================
app.use(cors());
app.use(express.json());

// ================= WEBHOOK STRIPE =================
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("❌ Erro no webhook:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        // ===== Busca os itens do checkout =====
        const lineItems = await stripe.checkout.sessions.listLineItems(
          session.id
        );

        // ===== Cria pedido na Shopify =====
        await createShopifyOrder(session, lineItems);

        // ===== Envia evento de Purchase para Meta Pixel =====
        if (session.metadata?.source === "campaign") { // só envia se vier da campanha
          await sendMetaPurchase(session);
        }

        res.json({ received: true });
      } catch (err) {
        console.error("❌ Erro no webhook:", err);
        res.status(500).send("Webhook handler error");
      }
    } else {
      res.json({ received: true });
    }
  }
);

// ===== Função criar pedido Shopify =====
async function createShopifyOrder(session, lineItems) {
  try {
    const shopifyLineItems = lineItems.data.map((item) => ({
      title: item.description,
      quantity: item.quantity,
      price: (item.amount_total / 100).toFixed(2),
    }));

    const response = await fetch(
      "https://15e136-1g.myshopify.com/admin/api/2024-01/orders.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_TOKEN,
        },
        body: JSON.stringify({
          order: {
            email: session.customer_email,
            shipping_address: session.shipping ? {
              first_name: session.shipping.name?.split(" ")[0] || "",
              last_name: session.shipping.name?.split(" ")[1] || "",
              address1: session.shipping.address.line1,
              city: session.shipping.address.city,
              country: session.shipping.address.country,
              zip: session.shipping.address.postal_code,
            } : undefined,
            line_items: shopifyLineItems,
            financial_status: "paid",
          },
        }),
      }
    );

    const data = await response.json();
    console.log("✅ Pedido criado na Shopify:", data);
  } catch (error) {
    console.error("❌ Erro ao criar pedido na Shopify:", error);
  }
}

// ===== Função enviar evento Purchase para Meta =====
async function sendMetaPurchase(session) {
  try {
    const hashedEmail = session.customer_email
      ? crypto.createHash("sha256").update(session.customer_email).digest("hex")
      : null;

    await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.META_PIXEL_ID}/events`,
      {
        data: [
          {
            event_name: "Purchase",
            event_time: Math.floor(Date.now() / 1000),
            action_source: "website",
            event_source_url: "https://aveneli.com",
            user_data: hashedEmail ? { em: [hashedEmail] } : {},
            custom_data: {
              currency: session.currency.toUpperCase(),
              value: (session.amount_total / 100).toFixed(2),
            },
          },
        ],
        access_token: process.env.META_ACCESS_TOKEN,
      }
    );

    console.log("✅ Evento Purchase enviado para Meta.");
  } catch (err) {
    console.error("❌ Erro ao enviar evento Purchase para Meta:", err.response?.data || err.message);
  }
}

// ================= ENDPOINT CHECKOUT =================
app.post("/checkout", async (req, res) => {
  const { items, email, source } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Itens do carrinho são obrigatórios" });
  }

  try {
    console.log("📦 Items recebidos:", items);

    const stripeItems = items.map((item) => ({
      price_data: {
        currency: "eur",
        product_data: { name: item.name, images: item.image ? [item.image] : [] },
        unit_amount: item.price,
      },
      quantity: item.quantity,
    }));

    const totalValue = stripeItems
      .reduce((acc, item) => acc + (item.price_data.unit_amount / 100) * item.quantity, 0)
      .toFixed(2);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "klarna", "ideal"],
      mode: "payment",
      line_items: stripeItems,
      ...(email ? { customer_email: email } : {}),
      metadata: { source: source || "" }, // para saber se veio da campanha
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["NL","BE","DE","FR","IT","ES","PT","FI","AT","IE"],
      },
      success_url: "https://aveneli.com/pages/sucesso",
      cancel_url: "https://aveneli.com/pages/cancelado",
    });

    // Envia evento InitiateCheckout (não bloqueia)
    if (process.env.META_PIXEL_ID && process.env.META_ACCESS_TOKEN && source === "campaign") {
      const hashedEmail = email ? crypto.createHash("sha256").update(email).digest("hex") : null;
      await axios.post(
        `https://graph.facebook.com/v20.0/${process.env.META_PIXEL_ID}/events`,
        {
          data: [
            {
              event_name: "InitiateCheckout",
              event_time: Math.floor(Date.now() / 1000),
              action_source: "website",
              event_source_url: "https://aveneli.com",
              user_data: hashedEmail ? { em: [hashedEmail] } : {},
              custom_data: { currency: "EUR", value: totalValue },
            },
          ],
          access_token: process.env.META_ACCESS_TOKEN,
        }
      );
      console.log("✅ Evento InitiateCheckout enviado para Meta.");
    }

    res.json({ checkout_url: session.url, value: totalValue, currency: "EUR", email });
  } catch (err) {
    console.error("❌ Erro ao criar checkout:", err.response?.data || err.message);
    res.status(500).json({ error: "Erro ao criar checkout" });
  }
});

// ================= HEALTH =================
app.get("/health", (req, res) => res.status(200).send("OK"));

// ================= HOME =================
app.get("/", (req, res) =>
  res.send("✅ API Stripe Klarna/iDEAL rodando e integrada com Shopify + Meta Pixel")
);

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
