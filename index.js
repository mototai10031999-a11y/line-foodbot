require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const { Client, middleware } = require('@line/bot-sdk');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// public フォルダの静的ファイルを読み込む
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// LINE Bot 設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

// MongoDB 接続
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const restaurantSchema = new mongoose.Schema({
  name: String,
  token: String,
  today: Array,
  stripeCustomerId: String,
  subscriptionStatus: { type: String, default: 'trial' },
});
const Restaurant = mongoose.model('Restaurant', restaurantSchema);

const upload = multer({ dest: 'uploads/' });
const reservations = {};

// LINE Webhook
app.post('/webhook', middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// LINE イベント処理
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const msg = event.message.text.trim();

  if (msg === 'ID教えて') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `あなたのユーザーIDは: ${event.source.userId}`,
    });
  }

  if (msg.startsWith('今日のおすすめ')) {
    const parts = msg.split(' ');
    const key = parts[1];
    const restaurant = await Restaurant.findOne({ token: key });
    if (!restaurant) return client.replyMessage(event.replyToken, { type: 'text', text: '店舗情報が見つかりません。' });

    const items = restaurant.today.map(i => `・${i.name} ${i.discount_price}円 → ${i.price}円`).join('\n');
    return client.replyMessage(event.replyToken, { type: 'text', text: `${restaurant.name} の今日の閉店前お得情報はこちらです：\n${items}` });
  }

  if (msg.startsWith('予約')) {
    const parts = msg.split(' ');
    const key = parts[1];
    const num = parts[2];
    const restaurant = await Restaurant.findOne({ token: key });
    if (!restaurant || !num) return client.replyMessage(event.replyToken, { type: 'text', text: '予約形式が正しくありません。「予約 [店舗トークン] [人数]」' });

    if (!reservations[key]) reservations[key] = [];
    reservations[key].push({ userId: event.source.userId, num });

    return client.replyMessage(event.replyToken, { type: 'text', text: `${restaurant.name} への予約を受け付けました。人数: ${num}` });
  }

  return client.replyMessage(event.replyToken, { type: 'text', text: '「今日のおすすめ [店舗トークン]」か「予約 [店舗トークン] [人数]」で送信してください。' });
}

// 投稿フォーム処理
app.post('/post', upload.single('image'), async (req, res) => {
  const { name, price, discount_price, deadline, token } = req.body;
  const image = req.file ? req.file.filename : null;

  const restaurant = await Restaurant.findOne({ token });
  if (!restaurant) return res.status(403).send('無効なトークンです。');

  restaurant.today.push({ name, price, discount_price, deadline, image });
  await restaurant.save();

  try {
    const notifyText = `【${restaurant.name}】新しい商品投稿:\n名前: ${name}\n通常価格: ${price}\n割引価格: ${discount_price}\n販売期限: ${deadline}`;
    await client.pushMessage(process.env.LINE_ADMIN_USERID, { type: 'text', text: notifyText });
  } catch (err) {
    console.error('LINE通知エラー:', err);
  }

  res.send('投稿完了！LINEに通知も送信されました。');
});

// Stripe トライアル登録
app.post('/subscribe', async (req, res) => {
  const { email, restaurantName } = req.body;
  try {
    const customer = await stripe.customers.create({ email });
    await stripe.subscriptions.create({ customer: customer.id, items: [{ price: process.env.STRIPE_PRICE_ID }], trial_period_days: 30 });

    const token = Math.random().toString(36).substring(2, 10);
    const newRestaurant = new Restaurant({ name: restaurantName, token, today: [], stripeCustomerId: customer.id, subscriptionStatus: 'trial' });
    await newRestaurant.save();

    res.json({ status: 'ok', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Stripeエラー' });
  }
});

// ✅ サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));

