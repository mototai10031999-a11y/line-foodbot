require('dotenv').config();
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const { Client, middleware } = require('@line/bot-sdk');

const app = express();

app.use(express.static('public'));

// LINE Bot設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

// JSONデータ初期化
if (!fs.existsSync('data.json')) {
  fs.writeFileSync('data.json', JSON.stringify({
    restaurantA: { name: "レストランA", today: [] },
    restaurantB: { name: "レストランB", today: [] }
  }, null, 2));
}

// アップロード画像の設定
const upload = multer({ dest: 'uploads/' });
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// LINE Webhook
app.post('/webhook', middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(result => res.json(result))
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

// 簡易予約管理
const reservations = {};

// イベント処理（全イベントログ＋テキスト返信）
async function handleEvent(event) {
  console.log('===== Event received =====');
  console.log(JSON.stringify(event, null, 2));
  console.log('==========================');

  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const msg = event.message.text.trim();

  // 「ID教えて」でユーザーID返信（管理用）
  if (msg === 'ID教えて') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `あなたのユーザーIDは: ${event.source.userId}`
    });
  }

  // 「今日のおすすめ [店舗名]」
  if (msg.startsWith('今日のおすすめ')) {
    const parts = msg.split(' ');
    const key = parts[1];
    const data = JSON.parse(fs.readFileSync('data.json'));

    if (!data[key]) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '店舗情報が見つかりません。正しい店舗名を入力してください。',
      });
    }

    const items = data[key].today.map(i => `・${i.name} ${i.discount_price}円 → ${i.price}円まで`).join('\n');
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `${data[key].name} の今日の閉店前お得情報はこちらです：\n${items}`,
    });
  }

  // 予約メッセージ
  if (msg.startsWith('予約')) {
    const parts = msg.split(' ');
    const key = parts[1];
    const num = parts[2];
    const data = JSON.parse(fs.readFileSync('data.json'));

    if (!data[key] || !num) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '予約の形式が正しくありません。「予約 [店舗名] [人数]」で送信してください。',
      });
    }

    if (!reservations[key]) reservations[key] = [];
    reservations[key].push({ userId: event.source.userId, num });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `${data[key].name} への予約を受け付けました。人数: ${num}`,
    });
  }

  // それ以外
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '「今日のおすすめ [店舗名]」か「予約 [店舗名] [人数]」で送信してください。',
  });
}

// フォーム送信用ルート
app.use(express.urlencoded({ extended: true }));

app.post('/post', upload.single('image'), async (req, res) => {
  const { name, price, discount_price, deadline } = req.body;
  const image = req.file ? req.file.filename : null;
  const data = JSON.parse(fs.readFileSync('data.json'));

  const newPost = { name, price, discount_price, deadline, image };

  // restaurantA に追加（例）
  if (!data.restaurantA.today) data.restaurantA.today = [];
  data.restaurantA.today.push(newPost);

  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));

  // LINE通知
  try {
    const notifyText = `新しい商品投稿があります：\n名前: ${name}\n通常価格: ${price}\n割引価格: ${discount_price}\n販売期限: ${deadline}`;
    await client.pushMessage(process.env.LINE_ADMIN_USERID, { type: 'text', text: notifyText });
  } catch (err) {
    console.error('LINE通知エラー:', err);
  }

  res.send('投稿が完了しました！LINEに通知も送信されました。');
});

// サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));
