import express from "express";
import Stripe from "stripe";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
const port = process.env.PORT || 3000;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("API Stripe + Shopify funcionando");
});

app.get("/create-checkout", async (req, res) => {
  try {

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "klarna", "ideal"],

      customer_creation: "always",

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Wood Therapy Roller – Lymphatic Massage & Body Care",
              metadata: {
                variant_id: "51213440745748"
              }
            },
            unit_amount: 2303
          },
          quantity: 1
        }
      ],

      mode: "payment",

      success_url: "https://seusite.com/sucesso",
      cancel_url: "https://seusite.com/cancelado"
    });

    res.redirect(session.url);

  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});


app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {

  const sig = req.headers["stripe-signature"];
  let event;

  try {

    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

  } catch (err) {

    console.error("Erro webhook:", err.message);
    return res.status(400).send(err.message);

  }

  if (event.type === "checkout.session.completed") {

    const session = event.data.object;

    try {

      const lineItems = await stripe.checkout.sessions.listLineItems(
        session.id,
        { expand: ["data.price.product"] }
      );

      const shopifyLineItems = lineItems.data.map(item => ({
        variant_id: parseInt(item.price.product.metadata.variant_id),
        quantity: item.quantity
      }));

      const order = {
        order: {
          email: session.customer_details.email,
          financial_status: "paid",
          currency: session.currency.toUpperCase(),
          line_items: shopifyLineItems
        }
      };

      const response = await axios.post(
        `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/orders.json`,
        order,
        {
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
            "Content-Type": "application/json"
          }
        }
      );

      console.log("Pedido criado:", response.data);

    } catch (err) {

      console.error("Erro criando pedido:", err.response?.data || err);

    }

  }

  res.send({ received: true });

});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
