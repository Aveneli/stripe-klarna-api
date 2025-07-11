const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');

app.use(cors());
app.use(express.json());

app.post('/checkout', async (req, res) => {
  console.log("Body recebido:", JSON.stringify(req.body, null, 2));
  const { items } = req.body;

  try {
    console.log('Itens formatados para Stripe:', JSON.stringify(items, null, 2));

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
      success_url: 'https://aveneli.com/pages/sucesso',
      cancel_url: 'https://aveneli.com/pages/cancelado',
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    console.error('Erro ao criar checkout:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('API Stripe Klarna/IDeal funcionando!');
});

// ✅ PORT declarado apenas uma vez:
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
