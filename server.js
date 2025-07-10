const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');

app.use(cors());
app.use(express.json());

app.post('/checkout', async (req, res) => {
  const { amount, quantity, description, image } = req.body;

  if (!amount || !quantity || !description) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  try {
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
            unit_amount: Math.round(amount * 100), // em centavos
          },
          quantity: quantity,
        },
      ],
      mode: 'payment',
      success_url: 'https://aveneli.com/pages/success',
      cancel_url: 'https://aveneli.com/pages/cancel',
    });

    res.json({ checkout_url: session._

