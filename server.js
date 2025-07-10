const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');

app.use(cors());
app.use(express.json());

app.post('/checkout', async (req, res) => {
  const { amount, quantity, description } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['ideal', 'klarna', 'card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: description || 'Produto',
            },
            unit_amount: Math.round(amount * 100), // valor em centavos
          },
          quantity: quantity || 1,
        },
      ],
      mode: 'payment',
      success_url: 'https://sualoja.com/sucesso',
      cancel_url: 'https://sualoja.com/cancelado',
      ui_mode: 'hosted',
      customizations: {
        logo: 'https://cdn.shopify.com/s/files/1/0953/6041/8068/files/AVENELI_1_466f2404-11f9-4f16-901c-a5d59874425c.png?v=1751317409',
        accent_color: '#F6F2E9',
      },
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    console.error('Erro ao criar checkout:', err);
    res.status(500).json({ error: 'Erro ao criar sessão de checkout' });
  }
});

app.get('/', (req, res) => {
  res.send('API Stripe Klarna/IDeal funcionando!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
