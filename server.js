const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');

app.use(cors());
app.use(express.json());

app.post('/checkout', async (req, res) => {
  const { items } = req.body;

  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Itens inválidos no corpo da requisição.' });
    }

    const line_items = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.name || 'Produto',
          images: item.image ? [item.image] : [],
        },
        unit_amount: Math.round(item.price), // já deve estar em centavos
      },
      quantity: item.quantity || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['ideal', 'klarna', 'card'],
      line_items,
      mode: 'payment',
      success_url: 'https://aveneli.com/pages/sucesso',
      cancel_url: 'https://aveneli.com/pages/cancelado',
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    console.error('Erro ao criar checkout:', err);
    res.status(500).json({ error: 'Erro ao criar sessão de checkout' });
  }
});

app.get('/', (req, res) => {
  res.send('API Stripe Klarna/iDEAL funcionando!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});


// Inicializa o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
