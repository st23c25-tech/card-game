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
    console.log(`Room created: ${roomId}`);
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
    room.playerNames.push({ id: socket.id, name: `Гравець ${room.players.length + 1}` });
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
      log: ['Гра почалась!']
    };
    
    for (let p of room.gameState.players) {
      io.to(p.id).emit('gameStarted', {
        hiddenCards: p.hidden,
        openCard: p.openCard
      });
    }
    
    io.to(roomId).emit('updateState', room.gameState);
    nextTurn(roomId);
  }

  function nextTurn(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    
    const currentPlayer = state.players[state.currentTurn];
    io.to(roomId).emit('yourTurn', { playerId: currentPlayer.id, playerName: currentPlayer.name });
  }

  socket.on('drawCard', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (state.players[state.currentTurn].id !== socket.id) {
      socket.emit('error', 'Не твоя черга');
      return;
    }
    
    if (state.deck.length === 0) {
      socket.emit('error', 'Колода порожня');
      return;
    }
    
    const drawnCard = state.deck.pop();
    socket.emit('cardDrawn', { card: drawnCard });
    state.lastDrawnCard = drawnCard;
  });

  socket.on('takeCard', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    player.hand.push(state.lastDrawnCard);
    state.log.push(`${player.name} забрав карту ${state.lastDrawnCard.value}${state.lastDrawnCard.suit}`);
    state.lastDrawnCard = null;
    state.currentTurn = (state.currentTurn + 1) % state.players.length;
    
    io.to(roomId).emit('updateState', state);
    nextTurn(roomId);
  });

  socket.on('placeCard', (roomId, targetPlayerId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    const target = state.players.find(p => p.id === targetPlayerId);
    
    if (!target || !target.openCard) return;
    
    if (isOneLower(state.lastDrawnCard, target.openCard)) {
      target.openCard = state.lastDrawnCard;
      state.log.push(`${player.name} поклав ${state.lastDrawnCard.value}${state.lastDrawnCard.suit} на карту ${target.name}`);
      state.lastDrawnCard = null;
      state.currentTurn = (state.currentTurn + 1) % state.players.length;
      
      io.to(roomId).emit('updateState', state);
      nextTurn(roomId);
    } else {
      socket.emit('error', 'Не можна покласти');
    }
  });

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
