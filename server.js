// server.js
const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');

app.use(cors());

// ⚠️ NÃO usar express.json() antes do webhook!
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Erro na verificação do webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    console.log('✅ Pagamento confirmado! Enviando evento para Meta...');

    axios.post(`https://graph.facebook.com/v19.0/${process.env.META_PIXEL_ID}/events`, {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_source_url: 'https://aveneli.com',
        user_data: {
          em: [session.customer_email ? crypto.createHash('sha256').update(session.customer_email).digest('hex') : ''],
        },
        custom_data: {
          currency: session.currency.toUpperCase(),
          value: (session.amount_total / 100).toFixed(2)
        }
      }],
      access_token: process.env.META_ACCESS_TOKEN
    }).then(() => {
      console.log('🎉 Evento enviado com sucesso para Meta!');
    }).catch(err => {
      console.error('❌ Erro ao enviar evento para Meta:', err.response?.data || err.message);
    });
  }

  res.json({ received: true });
});

// ✅ Agora sim, ativar o JSON depois do webhook
app.use(express.json());

app.post('/create-order', async (req, res) => {
  const { items, customer } = req.body;

  if (!items || !customer || !customer.email || !customer.name || !customer.address) {
    return res.status(400).json({ error: 'Dados incompletos para criar pedido' });
  }

  try {
    const shopifyOrder = await axios.post(
      'https://aveneli.com/admin/api/2024-01/orders.json',
      {
        order: {
          email: customer.email,
          send_receipt: true,
          send_fulfillment_receipt: true,
          customer: {
            first_name: customer.name.split(' ')[0],
            last_name: customer.name.split(' ').slice(1).join(' ') || '',
            email: customer.email
          },
          shipping_address: customer.address,
          line_items: items.map(item => ({
            title: item.name,
            price: (item.price / 100).toFixed(2),
            quantity: item.quantity
          })),
          financial_status: 'pending'
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('🛒 Pedido criado na Shopify:', shopifyOrder.data.order.id);

    const stripeItems = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.name,
          images: item.image ? [item.image] : [],
        },
        unit_amount: item.price,
      },
      quantity: item.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['ideal', 'klarna', 'card'],
      line_items: stripeItems,
      mode: 'payment',
      customer_email: customer.email,
      success_url: 'https://aveneli.com/pages/sucesso',
      cancel_url: 'https://aveneli.com/pages/cancelado',
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    console.error('❌ Erro ao criar pedido ou checkout:', err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao criar pedido ou checkout' });
  }
});

app.get('/', (req, res) => {
  res.send('✅ API Stripe Klarna/iDEAL funcionando com criação de pedidos Shopify');
});

// ✅ Inicialização do servidor (mantida apenas uma vez!)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
