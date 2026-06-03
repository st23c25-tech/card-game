const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));

const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
let fullDeck = [];

for (let s of suits) {
  for (let v of values) {
    fullDeck.push({ suit: s, value: v });
  }
}

function shuffle(d) {
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function getValueRank(value) {
  const order = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  return order.indexOf(value);
}

function isOneLower(card1, card2) {
  if (!card1 || !card2) return false;
  const rank1 = getValueRank(card1.value);
  const rank2 = getValueRank(card2.value);
  if (card1.value === '6' && card2.value === 'A') return true;
  return rank1 === rank2 - 1;
}

function canRedrawToAnyone(state, playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player || !player.openCard) return [];
  const targets = [];
  for (let p of state.players) {
    if (p.id !== playerId && p.openCard && isOneLower(player.openCard, p.openCard)) {
      targets.push(p);
    }
  }
  return targets;
}

function canPlaceToAnyone(state, card, playerId) {
  const targets = [];
  for (let p of state.players) {
    if (p.id !== playerId && p.openCard && isOneLower(card, p.openCard)) {
      targets.push(p);
    }
  }
  return targets;
}

const rooms = new Map();
let globalPlayerCounter = 0;

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('createGame', () => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    globalPlayerCounter++;
    rooms.set(roomId, {
      players: [socket.id],
      playerNames: [{ id: socket.id, name: `Гравець ${globalPlayerCounter}` }],
      gameState: null,
      round: 1
    });
    socket.join(roomId);
    socket.emit('gameCreated', roomId);
  });

  socket.on('joinGame', (roomId) => {
    if (!rooms.has(roomId)) {
      socket.emit('error', 'Кімнати не існує');
      return;
    }
    const room = rooms.get(roomId);
    if (room.players.length >= 6) {
      socket.emit('error', 'Кімната повна');
      return;
    }
    room.players.push(socket.id);
    room.playerNames.push({ id: socket.id, name: `Гравець ${room.players.length}` });
    socket.join(roomId);
    socket.emit('joined', roomId);
    io.to(roomId).emit('playerJoined', { count: room.players.length, players: room.playerNames });
  });

  socket.on('startGame', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length < 2) {
      socket.emit('error', 'Потрібно мінімум 2 гравці');
      return;
    }
    startGame(roomId);
  });

  function startGame(roomId) {
    const room = rooms.get(roomId);
    let deck = shuffle([...fullDeck]);
    
    const playersData = [];
    for (let i = 0; i < room.players.length; i++) {
      const hidden = [deck.pop(), deck.pop()];
      const openCard = deck.pop();
      playersData.push({
        id: room.players[i],
        name: room.playerNames.find(p => p.id === room.players[i]).name,
        hidden: hidden,
        openCard: openCard,
        hand: []
      });
    }
    
    room.gameState = {
      deck: deck,
      players: playersData,
      currentTurn: 0,
      phase: 'redraw',
      log: ['Гра почалась!']
    };
    
    for (let p of room.gameState.players) {
      io.to(p.id).emit('gameStarted', {
        hiddenCards: p.hidden,
        openCard: p.openCard
      });
    }
    
    io.to(roomId).emit('updateState', room.gameState);
    startTurn(roomId);
  }

  function startTurn(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const currentPlayer = state.players[state.currentTurn];
    
    // Спочатку фаза перекладання
    state.phase = 'redraw';
    const targets = canRedrawToAnyone(state, currentPlayer.id);
    
    io.to(roomId).emit('yourTurn', {
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      phase: 'redraw',
      canRedraw: targets.length > 0,
      redrawTargets: targets.map(t => ({ id: t.id, name: t.name, openCard: t.openCard }))
    });
  }

  socket.on('redrawCard', (roomId, targetPlayerId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    const target = state.players.find(p => p.id === targetPlayerId);
    
    if (state.phase !== 'redraw') {
      socket.emit('error', 'Зараз не фаза перекладання');
      return;
    }
    
    if (state.players[state.currentTurn].id !== socket.id) {
      socket.emit('error', 'Не твоя черга');
      return;
    }
    
    if (!target || !target.openCard || !isOneLower(player.openCard, target.openCard)) {
      socket.emit('error', 'Не можна перекласти на цю карту');
      return;
    }
    
    // Перекладаємо карту
    const transferredCard = player.openCard;
    player.openCard = null;
    target.openCard = transferredCard;
    
    // Відкриваємо нову карту з закритих
    if (player.hidden && player.hidden.length > 0) {
      player.openCard = player.hidden.pop();
      state.log.push(`${player.name} відкрив нову карту: ${player.openCard.value}${player.openCard.suit}`);
    }
    
    state.log.push(`${player.name} переклав ${transferredCard.value}${transferredCard.suit} на ${target.name}`);
    io.to(roomId).emit('updateState', state);
    
    // Після перекладання - переходимо до тягнення
    startDrawingPhase(roomId);
  });

  socket.on('skipRedraw', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    
    if (state.phase !== 'redraw') {
      socket.emit('error', 'Зараз не фаза перекладання');
      return;
    }
    
    if (state.players[state.currentTurn].id !== socket.id) {
      socket.emit('error', 'Не твоя черга');
      return;
    }
    
    state.log.push(`${state.players[state.currentTurn].name} пропустив перекладання`);
    io.to(roomId).emit('updateState', state);
    startDrawingPhase(roomId);
  });

  function startDrawingPhase(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const currentPlayer = state.players[state.currentTurn];
    
    state.phase = 'drawing';
    io.to(roomId).emit('yourTurn', {
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      phase: 'drawing'
    });
  }

  socket.on('drawCard', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (state.phase !== 'drawing') {
      socket.emit('error', 'Зараз не фаза тягнення');
      return;
    }
    
    if (state.players[state.currentTurn].id !== socket.id) {
      socket.emit('error', 'Не твоя черга');
      return;
    }
    
    if (state.deck.length === 0) {
      socket.emit('error', 'Колода порожня');
      return;
    }
    
    const drawnCard = state.deck.pop();
    state.lastDrawnCard = drawnCard;
    state.phase = 'placing';
    
    const canPlaceToOthers = canPlaceToAnyone(state, drawnCard, socket.id);
    const canPlaceToSelf = player.openCard && isOneLower(drawnCard, player.openCard);
    
    io.to(socket.id).emit('cardDrawn', {
      card: drawnCard,
      canPlaceToOthers: canPlaceToOthers.length > 0,
      canPlaceToSelf: canPlaceToSelf,
      placeTargets: canPlaceToOthers.map(t => ({ id: t.id, name: t.name, openCard: t.openCard }))
    });
  });

  socket.on('placeOnOther', (roomId, targetPlayerId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    const target = state.players.find(p => p.id === targetPlayerId);
    
    if (state.phase !== 'placing') {
      socket.emit('error', 'Зараз не можна покласти карту');
      return;
    }
    
    if (!target || !target.openCard || !isOneLower(state.lastDrawnCard, target.openCard)) {
      socket.emit('error', 'Не можна покласти на цю карту');
      return;
    }
    
    target.openCard = state.lastDrawnCard;
    state.log.push(`${player.name} поклав ${state.lastDrawnCard.value}${state.lastDrawnCard.suit} на карту ${target.name}`);
    endTurn(roomId);
  });

  socket.on('placeOnSelf', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (state.phase !== 'placing') {
      socket.emit('error', 'Зараз не можна покласти карту');
      return;
    }
    
    if (!player.openCard || !isOneLower(state.lastDrawnCard, player.openCard)) {
      socket.emit('error', 'Не можна покласти на свою карту');
      return;
    }
    
    player.openCard = state.lastDrawnCard;
    state.log.push(`${player.name} поклав ${state.lastDrawnCard.value}${state.lastDrawnCard.suit} на свою карту`);
    endTurn(roomId);
  });

  socket.on('takeToHand', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (state.phase !== 'placing') {
      socket.emit('error', 'Зараз не можна забрати карту');
      return;
    }
    
    player.hand.push(state.lastDrawnCard);
    state.log.push(`${player.name} забрав карту ${state.lastDrawnCard.value}${state.lastDrawnCard.suit} собі`);
    endTurn(roomId);
  });

  function endTurn(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    
    state.lastDrawnCard = null;
    state.phase = 'redraw';
    state.currentTurn = (state.currentTurn + 1) % state.players.length;
    
    io.to(roomId).emit('updateState', state);
    startTurn(roomId);
  }

  socket.on('disconnect', () => {
    for (let [roomId, room] of rooms.entries()) {
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        room.playerNames.splice(index, 1);
        io.to(roomId).emit('playerJoined', { count: room.players.length, players: room.playerNames });
        if (room.players.length === 0) rooms.delete(roomId);
        break;
      }
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server on port ${port}`));
