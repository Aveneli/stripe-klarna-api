const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');

app.use(cors());
app.use(express.json());

// Endpoint para checkout
app.post('/checkout', async (req, res) => {
  const { amount, quantity, description, image } = req.body;

  // Validação básica
  if (!amount || !quantity || !description) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  try {
    // Cria a sessão de checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['ideal', 'klarna', 'card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: description,
              ...(image && { images: [image] }),
            },
            unit_amount: Math.round(amount * 100), // Centavos de euro
          },
          quantity: quantity,
        },
      ],
      mode: 'payment',
      success_url: 'https://aveneli.com/pages/success',
      cancel_url: 'https://aveneli.com/pages/cancel',
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    console.error('Erro ao criar sessão de checkout:', err);
    res.status(500).json({ error: 'Erro ao criar sessão de checkout' });
  }
});

// Página base da API
app.get('/', (req, res) => {
  res.send('API Stripe Klarna/iDEAL funcionando!');
});

// Inicializa o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
