const express = require("express");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const fetch = require("node-fetch"); // caso use Node < 18

// ================= MIDDLEWARES =================
app.use(cors());

// ⚠️ NÃO colocar express.json() antes do webhook
// porque o Stripe precisa do raw body para validar a assinatura

// ================= WEBHOOK STRIPE =================
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      // 🔑 Validação correta com assinatura
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("❌ Erro na verificação do webhook:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log("✅ Evento recebido do Stripe:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        // ===== Busca os itens do checkout =====
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

        // ===== Cria pedido na Shopify =====
        try {
          const payload = {
            order: {
              email: session.customer_details?.email,
              financial_status: "paid",
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
              line_items: lineItems.data.map((item) => {
                const price =
                  item.amount_total && item.quantity
                    ? item.amount_total / 100 / item.quantity
                    : 0;
                return {
                  title: item.description,
                  quantity: item.quantity,
                  price: Number(price.toFixed(2)), // Shopify espera número decimal
                };
              }),
            },
          };

          console.log("📤 Enviando pedido para Shopify:", JSON.stringify(payload, null, 2));

          const response = await fetch(
            `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": process.env.SHOPIFY_API_TOKEN,
              },
              body: JSON.stringify(payload),
            }
          );

          const data = await response.json();
          if (!response.ok) {
            console.error("❌ Erro ao criar pedido na Shopify:", response.status, data.errors || data);
          } else {
            console.log("✅ Pedido criado na Shopify:", data);
          }
        } catch (err) {
          console.error("❌ Erro ao enviar requisição para Shopify:", err);
        }

        // ===== Envia evento de Purchase para Meta Pixel =====
        if (process.env.META_PIXEL_ID && process.env.META_ACCESS_TOKEN) {
          await axios.post(
            `https://graph.facebook.com/v20.0/${process.env.META_PIXEL_ID}/events`,
            {
              data: [
                {
                  event_name: "Purchase",
                  event_time: Math.floor(Date.now() / 1000),
                  action_source: "website",
                  event_source_url: "https://aveneli.com",
                  user_data: {
                    em: [
                      crypto
                        .createHash("sha256")
                        .update(session.customer_details?.email || "")
                        .digest("hex"),
                    ],
                  },
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
        }
      } catch (err) {
        console.error("❌ Erro no processamento do webhook:", err.message);
      }
    }

    res.json({ received: true });
  }
);

// ✅ Agora podemos ativar JSON normal para os outros endpoints
app.use(express.json());

// ================= ENDPOINT CHECKOUT =================
app.post("/checkout", async (req, res) => {
  const { items, email } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Itens do carrinho são obrigatórios" });
  }

  try {
    console.log("📦 Items recebidos:", items);

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

    const totalValue = stripeItems
      .reduce(
        (acc, item) =>
          acc + (item.price_data.unit_amount / 100) * item.quantity,
        0
      )
      .toFixed(2);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "klarna", "ideal"],
      mode: "payment",
      line_items: stripeItems,
      ...(email ? { customer_email: email } : {}),
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["NL", "BE", "DE", "FR", "IT", "ES", "PT", "FI", "AT", "IE"],
      },
      success_url: "https://aveneli.com/pages/sucesso",
      cancel_url: "https://aveneli.com/pages/cancelado",
    });

    res.json({
      checkout_url: session.url,
      value: totalValue,
      currency: "EUR",
      email,
    });

    // ===== Envia evento InitiateCheckout para Meta =====
    if (process.env.META_PIXEL_ID && process.env.META_ACCESS_TOKEN) {
      const hashedEmail = email
        ? crypto.createHash("sha256").update(email).digest("hex")
        : null;

      axios
        .post(
          `https://graph.facebook.com/v20.0/${process.env.META_PIXEL_ID}/events`,
          {
            data: [
              {
                event_name: "InitiateCheckout",
                event_time: Math.floor(Date.now() / 1000),
                action_source: "website",
                event_source_url: "https://aveneli.com",
                user_data: hashedEmail ? { em: [hashedEmail] } : {},
                custom_data: {
                  currency: "EUR",
                  value: totalValue,
                },
              },
            ],
            access_token: process.env.META_ACCESS_TOKEN,
          }
        )
        .then(() => console.log("✅ Evento InitiateCheckout enviado para Meta."))
        .catch((e) =>
          console.error("❌ Erro ao enviar InitiateCheckout:", e.response?.data || e.message)
        );
    }
  } catch (err) {
    console.error("❌ Erro ao criar checkout:", err.response?.data || err.message);
    res.status(500).json({ error: "Erro ao criar checkout" });
  }
});

// ================= ENDPOINT ADD PAYMENT INFO =================
app.post("/add-payment-info", async (req, res) => {
  const { email, value, currency = "EUR" } = req.body;

  if (!email || !value) {
    return res.status(400).json({ error: "Email e valor são obrigatórios" });
  }

  try {
    const hashedEmail = crypto.createHash("sha256").update(email).digest("hex");

    await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.META_PIXEL_ID}/events`,
      {
        data: [
          {
            event_name: "AddPaymentInfo",
            event_time: Math.floor(Date.now() / 1000),
            action_source: "website",
            event_source_url: "https://aveneli.com",
            user_data: { em: [hashedEmail] },
            custom_data: {
              currency,
              value,
            },
          },
        ],
        access_token: process.env.META_ACCESS_TOKEN,
      }
    );

    console.log("✅ Evento AddPaymentInfo enviado para Meta.");
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Erro ao enviar AddPaymentInfo:", err.response?.data || err.message);
    res.status(500).json({ error: "Erro ao enviar AddPaymentInfo" });
  }
});

// ================= HEALTH =================
app.get("/health", (req, res) => res.status(200).send("OK"));

// ================= HOME =================
app.get("/", (req, res) =>
  res.send("✅ API Stripe Klarna/iDEAL rodando e integrada com Shopify + Meta Pixel")
);

// ================= START =================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
