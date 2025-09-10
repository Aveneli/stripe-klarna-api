import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ==================================================
// 🚨 WEBHOOK (RAW BODY)
// ==================================================
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
      console.error("❌ Erro no webhook:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      console.log("✅ Pagamento concluído:", session.id);

      try {
        // ==================================================
        // 1. Criar pedido na Shopify
        // ==================================================
        const lineItems = await stripe.checkout.sessions.listLineItems(
          session.id
        );

        const shopifyOrder = {
          order: {
            email: session.customer_email,
            financial_status: "paid",
            send_receipt: true,
            send_fulfillment_receipt: true,
            line_items: lineItems.data.map((item) => ({
              title: item.description,
              quantity: item.quantity,
              price: (item.amount_total / 100).toFixed(2),
            })),
            shipping_address: {
              address1: session.shipping?.address?.line1 || "",
              address2: session.shipping?.address?.line2 || "",
              city: session.shipping?.address?.city || "",
              zip: session.shipping?.address?.postal_code || "",
              country: session.shipping?.address?.country || "",
              first_name: session.shipping?.name?.split(" ")[0] || "",
              last_name: session.shipping?.name?.split(" ").slice(1).join(" ") || "",
            },
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

        // ==================================================
        // 2. Enviar evento para Meta (Conversions API)
        // ==================================================
        const metaEvent = {
          data: [
            {
              event_name: "Purchase",
              event_time: Math.floor(Date.now() / 1000),
              event_source_url: "https://aveneli.com/checkout",
              user_data: {
                em: [hashSHA256(session.customer_email)], // hash do email
              },
              custom_data: {
                currency: session.currency,
                value: session.amount_total / 100,
              },
            },
          ],
        };

        const metaResponse = await fetch(
          `https://graph.facebook.com/v18.0/${process.env.META_PIXEL_ID}/events?access_token=${process.env.META_ACCESS_TOKEN}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(metaEvent),
          }
        );

        const metaData = await metaResponse.json();
        console.log("📡 Evento enviado para Meta:", metaData);
      } catch (err) {
        console.error("❌ Erro ao criar pedido/enviar evento:", err);
      }
    }

    res.json({ received: true });
  }
);

// ==================================================
// ⚡ Middleware JSON para outras rotas
// ==================================================
app.use(express.json());

// ==================================================
// ROTA DE CHECKOUT
// ==================================================
app.post("/checkout", async (req, res) => {
  try {
    const { items, customer } = req.body;

    const line_items = items.map((item) => ({
      price_data: {
        currency: "eur",
        product_data: {
          name: item.name,
          images: [item.image],
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "klarna", "ideal"],
      line_items,
      mode: "payment",
      success_url: "https://aveneli.com/success",
      cancel_url: "https://aveneli.com/cancel",
      customer_email: customer.email,
      shipping_address_collection: {
        allowed_countries: ["DE", "NL", "BE", "AT", "LU"],
      },
      metadata: {
        customer_name: customer.name,
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Erro ao criar sessão:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==================================================
// Função utilitária para hashear email (Meta API)
// ==================================================
import crypto from "crypto";
function hashSHA256(data) {
  return crypto.createHash("sha256").update(data.trim().toLowerCase()).digest("hex");
}

// ==================================================
// INICIAR SERVIDOR
// ==================================================
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
