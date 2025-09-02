// server.js
const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');

// ================= WEBHOOK STRIPE =================
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Erro no webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      // ===== Busca os itens do checkout para enviar à Shopify =====
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

      // ===== Envia evento de Purchase para Meta Pixel =====
      await axios.post(`https://graph.facebook.com/v19.0/${process.env.META_PIXEL_ID}/events`, {
        data: [{
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: 'https://aveneli.com',
          user_data: {
            em: [crypto.createHash('sha256').update(session.customer_email).digest('hex')],
          },
          custom_data: {
            currency: session.currency.toUpperCase(),
            value: (session.amount_total / 100).toFixed(2)
          }
        }],
        access_token: process.env.META_ACCESS_TOKEN
      });
      console.log('✅ Evento Purchase enviado para Meta.');

      // ===== Cria pedido na Shopify =====
      await axios.post(
        'https://aveneli.com/admin/api/2024-01/orders.json',
        {
          order: {
            email: session.customer_email,
            send_receipt: true,
            send_fulfillment_receipt: true,
            line_items: lineItems.data.map(item => ({
              title: item.description || 'Produto',
              quantity: item.quantity,
              price: (item.amount_total / 100).toFixed(2)
            })),
            financial_status: 'paid',
            shipping_address: session.customer_details?.address || {},
            customer: {
              first_name: session.customer_details?.name?.split(' ')[0] || '',
              last_name: session.customer_details?.name?.split(' ').slice(1).join(' ') || '',
              email: session.customer_email
            }
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('🛍️ Pedido criado na Shopify.');

    } catch (err) {
      console.error('❌ Erro no webhook:', err.response?.data || err.message);
    }
  }

  res.json({ received: true });
});

// ================= MIDDLEWARES =================
app.use(cors());
app.use(express.json());

// ================= ENDPOINT CHECKOUT =================
app.post('/checkout', async (req, res) => {
  const { items, email } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Itens do carrinho são obrigatórios' });
  }

  try {
    const stripeItems = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.name,
          images: item.image ? [item.image] : []
        },
        unit_amount: item.price
      },
      quantity: item.quantity
    }));

    const session = await stripe.checkout.sessions.create({
  payment_method_types: ['klarna', 'ideal', 'card'],
  mode: 'payment',
  line_items: stripeItems,
  ...(email ? { customer_email: email } : {}), // 🔥 só adiciona se existir
  customer_creation: 'always',
  billing_address_collection: 'required',
  shipping_address_collection: {
    allowed_countries: ['NL', 'BE', 'DE', 'FR', 'IT', 'ES', 'PT', 'US', 'CA', 'GB']
  },
  success_url: 'https://aveneli.com/pages/sucesso',
  cancel_url: 'https://aveneli.com/pages/cancelado'
});

    // ===== Envia evento InitiateCheckout e AddPaymentInfo para Meta Pixel =====
    const hashedEmail = email ? crypto.createHash('sha256').update(email).digest('hex') : null;

    await axios.post(`https://graph.facebook.com/v19.0/${process.env.META_PIXEL_ID}/events`, {
      data: [
        {
          event_name: 'InitiateCheckout',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: 'https://aveneli.com',
          user_data: hashedEmail ? { em: [hashedEmail] } : {},
          custom_data: {
            currency: 'EUR',
            value: stripeItems.reduce((acc, item) => acc + (item.price_data.unit_amount / 100) * item.quantity, 0).toFixed(2)
          }
        },
        {
          event_name: 'AddPaymentInfo',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: 'https://aveneli.com',
          user_data: hashedEmail ? { em: [hashedEmail] } : {},
          custom_data: {
            currency: 'EUR',
            value: stripeItems.reduce((acc, item) => acc + (item.price_data.unit_amount / 100) * item.quantity, 0).toFixed(2),
            payment_method: 'klarna/ideal/card'
          }
        }
      ],
      access_token: process.env.META_ACCESS_TOKEN
    });

    console.log('✅ Eventos InitiateCheckout e AddPaymentInfo enviados para Meta.');

    res.json({ checkout_url: session.url });
  } catch (err) {
    console.error('❌ Erro ao criar checkout:', err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao criar checkout' });
  }
});

// ================= HEALTH =================
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ================= HOME =================
app.get('/', (req, res) => {
  res.send('✅ API Stripe Klarna/iDEAL rodando e integrada com Shopify + Meta Pixel');
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
