const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));

const suits = ['♥', '♦', '♣', '♠'];
const values = ['6','7','8','9','10','J','Q','K','A'];
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
  const order = ['6','7','8','9','10','J','Q','K','A'];
  return order.indexOf(value);
}

function isOneLower(card1, card2) {
  if (!card1 || !card2) return false;
  const rank1 = getValueRank(card1.value);
  const rank2 = getValueRank(card2.value);
  if (card1.value === '6' && card2.value === 'A') return true;
  return rank1 === rank2 - 1;
}

const rooms = new Map();
let globalPlayerCounter = 0;

io.on('connection', (socket) => {
  console.log('👤 Гравець підключився:', socket.id);

  socket.on('createGame', () => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    globalPlayerCounter++;
    const playerNumber = globalPlayerCounter;
    rooms.set(roomId, {
      players: [socket.id],
      playerNames: [{ id: socket.id, name: `Гравець ${playerNumber}` }],
      gameState: null,
      penaltyCards: new Map(),
      round: 1,
      playerCounter: playerNumber
    });
    socket.join(roomId);
    socket.emit('gameCreated', roomId);
    console.log(`🎮 Кімнату створено: ${roomId}`);
  });

  socket.on('joinGame', (roomId) => {
    if (!rooms.has(roomId)) {
      socket.emit('error', '❌ Кімнати не існує');
      return;
    }
    const room = rooms.get(roomId);
    if (room.players.length >= 6) {
      socket.emit('error', '❌ Кімната повна (макс 6 гравців)');
      return;
    }
    room.playerCounter++;
    const playerNumber = room.playerCounter;
    room.players.push(socket.id);
    room.playerNames.push({ id: socket.id, name: `Гравець ${playerNumber}` });
    socket.join(roomId);
    socket.emit('joined', roomId);
    io.to(roomId).emit('playerJoined', { count: room.players.length, players: room.playerNames });
    console.log(`👥 У кімнаті ${roomId} тепер ${room.players.length} гравців`);
  });

  socket.on('startGame', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length < 2) {
      socket.emit('error', '❌ Потрібно мінімум 2 гравці');
      return;
    }
    startNewRound(roomId);
  });

  function startNewRound(roomId) {
    const room = rooms.get(roomId);
    let gameDeck = shuffle([...fullDeck]);
    
    const playersData = [];
    for (let i = 0; i < room.players.length; i++) {
      const penaltyCount = room.penaltyCards.get(room.players[i]) || 2;
      const hidden = [];
      for (let j = 0; j < penaltyCount; j++) {
        if (gameDeck.length > 0) hidden.push(gameDeck.pop());
      }
      const openCard = gameDeck.pop();
      playersData.push({
        id: room.players[i],
        name: room.playerNames.find(p => p.id === room.players[i]).name,
        hidden: hidden,
        openCard: openCard,
        hand: [],
        isActive: true,
        penaltyCount: penaltyCount
      });
    }
    
    let trump = gameDeck.pop();
    if (trump.suit === '♠') {
      trump = gameDeck.pop();
    }
    
    room.gameState = {
      deck: gameDeck,
      trump: trump,
      players: playersData,
      currentDrawPlayer: 0,
      phase: 'drawing',
      log: [`🎴 Раунд ${room.round} почався! Козир: ${trump.value}${trump.suit}`],
      lastDrawnCard: null,
      waitingForPlace: false
    };
    
    for (let p of room.gameState.players) {
      io.to(p.id).emit('gameStarted', {
        hiddenCards: p.hidden,
        openCard: p.openCard,
        trump: room.gameState.trump,
        playersCount: room.players.length,
        yourName: p.name,
        penaltyCount: p.penaltyCount
      });
    }
    
    io.to(roomId).emit('updateState', room.gameState);
    announceTurn(roomId);
  }

  function announceTurn(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    
    // Перевірка на переможця
    const activePlayers = state.players.filter(p => p.isActive);
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      io.to(roomId).emit('gameEnd', { winner: winner.name, message: `🏆 ${winner.name} переміг!` });
      room.penaltyCards.set(winner.id, 2);
      for (let p of state.players) {
        if (p.id !== winner.id) {
          const current = room.penaltyCards.get(p.id) || 2;
          room.penaltyCards.set(p.id, current + 1);
        }
      }
      room.round++;
      startNewRound(roomId);
      return;
    }
    
    // Пропускаємо неактивних гравців
    let attempts = 0;
    while (state.players[state.currentDrawPlayer] && !state.players[state.currentDrawPlayer].isActive && attempts < state.players.length) {
      state.currentDrawPlayer = (state.currentDrawPlayer + 1) % state.players.length;
      attempts++;
    }
    
    const currentPlayer = state.players[state.currentDrawPlayer];
    io.to(roomId).emit('nextTurn', { 
      playerId: currentPlayer.id, 
      playerName: currentPlayer.name,
      phase: state.phase 
    });
  }

  socket.on('drawCard', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (!player || state.players[state.currentDrawPlayer].id !== socket.id) {
      socket.emit('error', '❌ Зараз не твоя черга тягнути');
      return;
    }
    
    if (state.phase !== 'drawing') {
      socket.emit('error', '❌ Зараз не фаза тягнення');
      return;
    }
    
    if (state.deck.length === 0) {
      socket.emit('error', '❌ Колода порожня!');
      return;
    }
    
    const drawnCard = state.deck.pop();
    state.lastDrawnCard = drawnCard;
    state.waitingForPlace = true;
    io.to(roomId).emit('cardDrawn', { card: drawnCard, playerId: socket.id });
    socket.emit('needDecision', { card: drawnCard });
  });

  socket.on('placeCard', (roomId, targetPlayerId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (!player || !state.waitingForPlace || state.phase !== 'drawing') {
      socket.emit('error', '❌ Не можна покласти карту зараз');
      return;
    }
    
    const targetPlayer = state.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer || !targetPlayer.openCard) {
      socket.emit('error', '❌ Не можна покласти на цю карту');
      return;
    }
    
    if (isOneLower(state.lastDrawnCard, targetPlayer.openCard)) {
      targetPlayer.openCard = state.lastDrawnCard;
      state.log.push(`${player.name} поклав ${state.lastDrawnCard.value}${state.lastDrawnCard.suit} на карту ${targetPlayer.name}`);
      state.waitingForPlace = false;
      state.lastDrawnCard = null;
      
      io.to(roomId).emit('updateState', state);
      
      // Перехід до наступного гравця
      state.currentDrawPlayer = (state.currentDrawPlayer + 1) % state.players.length;
      announceTurn(roomId);
    } else {
      socket.emit('error', '❌ Цю карту не можна покласти (потрібно на 1 нижче)');
    }
  });

  socket.on('takeToHand', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (!player || !state.waitingForPlace || state.phase !== 'drawing') {
      socket.emit('error', '❌ Не можна забрати карту зараз');
      return;
    }
    
    player.hand.push(state.lastDrawnCard);
    state.log.push(`${player.name} забрав карту ${state.lastDrawnCard.value}${state.lastDrawnCard.suit} собі`);
    state.waitingForPlace = false;
    state.lastDrawnCard = null;
    io.to(roomId).emit('updateState', state);
    
    // Перехід до наступного гравця
    state.currentDrawPlayer = (state.currentDrawPlayer + 1) % state.players.length;
    announceTurn(roomId);
  });

  socket.on('disconnect', () => {
    console.log('❌ Гравець відключився:', socket.id);
    for (let [roomId, room] of rooms.entries()) {
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        room.playerNames.splice(index, 1);
        io.to(roomId).emit('playerJoined', { count: room.players.length, players: room.playerNames });
        if (room.gameState) {
          const playerIndex = room.gameState.players.findIndex(p => p.id === socket.id);
          if (playerIndex !== -1) {
            room.gameState.players[playerIndex].isActive = false;
          }
          io.to(roomId).emit('updateState', room.gameState);
          announceTurn(roomId);
        }
        if (room.players.length === 0) {
          rooms.delete(roomId);
        }
        break;
      }
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`🎮 Сервер запущено на порту ${port}`);
  console.log('📋 Повна версія гри за твоїми правилами');
});
