import express from "express";
import Stripe from "stripe";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 8080;

// ----------------- Config -----------------
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ----------------- Middleware -----------------
app.use(
  "/webhook",
  bodyParser.raw({ type: "application/json" }) // necessário para validar webhook Stripe
);
app.use(express.json());

// ----------------- Checkout Stripe -----------------
app.get("/create-checkout", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "klarna", "ideal"],
      line_items: [
        {
          price_data: {
            currency: "eur", // moeda em euro
            product_data: {
              name: "Wood Therapy Roller – Lymphatic Massage & Body Care",
              metadata: {
                variant_id: "51213440745748", // ID da Shopify
              },
            },
            unit_amount: 2303, // 23,03 € em centavos
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "https://seusite.com/sucesso",
      cancel_url: "https://seusite.com/cancelado",
    });

    console.log("Checkout URL criado:", session.url);
    res.send({ url: session.url });
  } catch (err) {
    console.error("Erro criando checkout:", err);
    res.status(500).send({ error: err.message });
  }
});

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
    console.error("Erro no webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log("Evento recebido:", event.type);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        expand: ["data.price.product"],
      });

      console.log("Line items da Stripe:", lineItems.data);

      const shopifyLineItems = lineItems.data.map((item) => ({
        variant_id: parseInt(item.price.product.metadata.variant_id, 10),
        quantity: item.quantity,
      }));

      const shopifyOrder = {
        order: {
          email: session.customer_details?.email || "noemail@example.com",
          financial_status: "paid",
          currency: session.currency.toUpperCase(),
          line_items: shopifyLineItems,
        },
      };

      console.log("Pedido Shopify enviado:", shopifyOrder);

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
      if (!shopifyResponse.ok) console.error("Erro Shopify:", shopifyData);
      else console.log("✅ Pedido criado na Shopify:", shopifyData.order.id);
    } catch (err) {
      console.error("Erro processando checkout:", err);
    }
  }

  res.status(200).send({ received: true });
});

// ----------------- Start -----------------
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
