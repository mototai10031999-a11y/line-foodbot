require('dotenv').config();
const data = require('./data.json');
const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');

const app = express();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);

// メモリ上予約管理
const reservations = {};

// 距離計算（Haversine formula）
function getDistance(lat1, lng1, lat2, lng2) {
  const toRad = deg => deg * Math.PI / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// LINE Webhook
app.post('/webhook', middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(r => res.json(r))
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (event.type !== 'message') return null;

  // ① 位置情報受信
  if (event.message.type === 'location') {
    const userLat = event.message.latitude;
    const userLng = event.message.longitude;

    // 近隣店舗を距離順で取得（3件まで）
    const nearby = Object.keys(data)
      .map(key => ({ key, distance: getDistance(userLat, userLng, data[key].lat, data[key].lng) }))
      .sort((a,b) => a.distance - b.distance)
      .slice(0, 3);

    // クイックリプライで店舗選択
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '近くのお得なお店はこちらです。選択してください：',
      quickReply: {
        items: nearby.map(r => ({
          type: 'action',
          action: {
            type: 'message',
            label: data[r.key].name,
            text: `お店 ${r.key}`
          }
        }))
      }
    });
  }

  // ② テキストメッセージ処理
  if (event.message.type === 'text') {
    const msg = event.message.text.trim();

    // 店舗選択 → 商品一覧
    if (msg.startsWith('お店 ')) {
      const key = msg.split(' ')[1];
      if (!data[key]) return client.replyMessage(event.replyToken, { type:'text', text:'店舗がありません' });

      // 商品ボタンテンプレート
      const actions = data[key].today.map(item => ({
        type: 'message',
        label: `${item.name} ${item.discount}OFF`,
        text: `予約 ${key} ${item.name} 1` // 1個で仮
      }));

      return client.replyMessage(event.replyToken, {
        type: 'template',
        altText: `${data[key].name} の商品一覧`,
        template: {
          type: 'buttons',
          title: data[key].name,
          text: '商品を選んでください',
          actions
        }
      });
    }

    // 予約処理（簡易）
    if (msg.startsWith('予約')) {
      // 形式: 予約 [店舗名] [商品名] [数量]
      const parts = msg.split(' ');
      const key = parts[1];
      const itemName = parts[2];
      const qty = parts[3] || 1;

      if (!data[key]) return client.replyMessage(event.replyToken, { type:'text', text:'店舗がありません' });
      if (!reservations[key]) reservations[key] = [];
      reservations[key].push({ userId: event.source.userId, item: itemName, qty });

      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `${data[key].name} の ${itemName} を予約しました。数量: ${qty}`
      });
    }

    // その他
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '位置情報を送るか、「お店 [店舗名]」または「予約 [店舗名] [商品名] [数量]」で送信してください。'
    });
  }

  return null;
}

// サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running at ${port}`));
