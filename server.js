const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const fetch = require('node-fetch');

app.use(cors());
app.use(express.json());

const klarnaSupportedCountries = ['DE', 'AT', 'FI', 'NL', 'SE', 'NO', 'DK', 'BE'];
const idealSupportedCountries = ['NL'];
const blockedCountries = ['BR', 'CN', 'JP', 'CA', 'AU'];

async function getCountryByIP(ip) {
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`);
    const data = await res.json();
    return data.country || null;
  } catch (error) {
    console.error('Erro ao buscar o país por IP:', error);
    return null;
  }
}

app.post('/checkout', async (req, res) => {
  const { items } = req.body;
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;

  const country = await getCountryByIP(clientIp);

  if (!country || blockedCountries.includes(country)) {
    return res.status(403).json({ error: 'País não suportado para esse método de pagamento.' });
  }

  const enabledPaymentMethods = ['card'];
  if (klarnaSupportedCountries.includes(country)) enabledPaymentMethods.push('klarna');
  if (idealSupportedCountries.includes(country)) enabledPaymentMethods.push('ideal');

  try {
    const line_items = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.name || 'Produto',
          images: item.image ? [item.image] : [],
        },
        unit_amount: Math.round(item.price),
      },
      quantity: item.quantity || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: enabledPaymentMethods,
      line_items,
      mode: 'payment',
      success_url: 'https://aveneli.com/pages/success',
      cancel_url: 'https://aveneli.com/pages/cart',
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    console.error('Erro ao criar checkout:', err);
    res.status(500).json({ error: 'Erro ao criar sessão de checkout' });
  }
});

app.get('/', (req, res) => {
  res.send('API Stripe Klarna/iDEAL funcionando com filtro de países.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
