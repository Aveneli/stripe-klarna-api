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

// ----------------- Checkout Stripe -----------------
app.get("/create-checkout", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "klarna", "ideal"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Wood Therapy Roller – Lymphatic Massage & Body Care",
              metadata: { variant_id: "51213440745748" }, // ID da variante na Shopify
            },
            unit_amount: 2303, // 23,03 €
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "https://seusite.com/sucesso",
      cancel_url: "https://seusite.com/cancelado",
    });

    console.log("Checkout URL criado:", session.url);
    res.redirect(session.url);
  } catch (err) {
    console.error("Erro criando checkout:", err);
    res.status(500).send(`Erro: ${err.message}`);
  }
});

// ----------------- Webhook Stripe -----------------
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }), // necessário para assinatura Stripe
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

    console.log("✅ Evento recebido:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        // Buscar line items da sessão
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
          expand: ["data.price.product"],
        });

        console.log("Line items da Stripe:", lineItems.data);

        const shopifyLineItems = lineItems.data.map((item) => ({
          variant_id: parseInt(item.price.product.metadata.variant_id, 10),
          quantity: item.quantity,
        }));

        // Criar pedido Shopify
        const shopifyOrder = {
          order: {
            email: session.customer_details?.email || "noemail@example.com",
            financial_status: "paid",
            currency: session.currency.toUpperCase(),
            line_items: shopifyLineItems,
            shipping_address: {
              first_name: session.customer_details?.name?.split(" ")[0] || "Nome",
              last_name: session.customer_details?.name?.split(" ").slice(1).join(" ") || "Sobrenome",
              address1: session.customer_details?.address?.line1 || "Endereço",
              address2: session.customer_details?.address?.line2 || "",
              city: session.customer_details?.address?.city || "",
              country: session.customer_details?.address?.country || "",
              zip: session.customer_details?.address?.postal_code || ""
            },
            phone: session.customer_details?.phone || ""
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
        if (!shopifyResponse.ok) console.error("❌ Erro Shopify:", shopifyData);
        else console.log("✅ Pedido criado na Shopify:", shopifyData.order.id);
      } catch (err) {
        console.error("❌ Erro processando checkout:", err);
      }
    }

    res.status(200).send({ received: true });
  }
);

// ----------------- Start server -----------------
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});
